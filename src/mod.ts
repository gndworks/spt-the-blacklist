// Copyright (C) 2023 Platinum
// 
// This file is part of spt-the-blacklist.
// 
// spt-the-blacklist is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// spt-the-blacklist is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with spt-the-blacklist.  If not, see <http://www.gnu.org/licenses/>.

import { DependencyContainer } from "tsyringe";

import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { IRagfairConfig } from "@spt-aki/models/spt/config/IRagfairConfig";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { RagfairOfferGenerator } from "@spt-aki/generators/RagfairOfferGenerator";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";

import config from "../config.json";
import advancedConfig from "../advancedConfig.json";

class TheBlacklistMod implements IPostDBLoadMod {
  private logger: ILogger;

  private modName = "[The Blacklist]";

  // We to adjust for pricing using a baseline when mods like SPT Realism are used
  private baselineBullet: ITemplateItem;
  private baselineArmour: ITemplateItem;


  public postDBLoad(container: DependencyContainer): void {
    this.logger = container.resolve<ILogger>("WinstonLogger");

    // Easiest way to make mod compatible with Lua's flea updater is let the user choose when to load the mod...
    setTimeout(() => this.initialiseMod(container), config.startDelayInSeconds * 1000);
  }

  private initialiseMod(
    container: DependencyContainer
  ): void {
    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    const tables = databaseServer.getTables();
    const configServer = container.resolve<ConfigServer>("ConfigServer");
    const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);
    const ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
    const ragfairOfferGenerator = container.resolve<RagfairOfferGenerator>("RagfairOfferGenerator");

    const itemTable = tables.templates.items;
    const handbookItems = tables.templates.handbook.Items;
    const prices = tables.templates.prices;

    ragfairConfig.dynamic.blacklist.enableBsgList = !config.disableBsgBlacklist;

    this.baselineBullet = itemTable[advancedConfig.baselineBulletId];
    this.baselineArmour = itemTable[advancedConfig.baselineArmourId];

    let blacklistedItemsCount = 0;

    // Find all items to update by looping through handbook which is a better indicator of useable items.
    handbookItems.forEach(handbookItem => {
      const item = itemTable[handbookItem.Id];
      const customItemConfig = config.customItemConfigs.find(conf => conf.itemId === item._id);
      const originalPrice = prices[item._id];

      // We found a custom price override to use. That's all we care about for this item. Move on to the next item.
      if (customItemConfig?.fleaPriceOverride) {
        prices[item._id] = customItemConfig.fleaPriceOverride;

        this.debug(`Updated ${item._id} - ${item._name} flea price from ${originalPrice} to ${prices[item._id]} (price override).`);

        blacklistedItemsCount++;
        return;
      }

      const itemProps = item._props;
      if (!itemProps.CanSellOnRagfair) {
        itemProps.CanSellOnRagfair = config.disableBsgBlacklist;

        prices[item._id] = this.getUpdatedPrice(item, prices);

        if (!prices[item._id]) {
          this.debug(`There are no flea prices for ${item._id} - ${item._name}!`);
          return;
        }

        this.debug(`Updated ${item._id} - ${item._name} flea price from ${originalPrice} to ${prices[item._id]}.`);

        blacklistedItemsCount++;
      }

      const itemSpecificPriceMultiplier = customItemConfig?.priceMultiplier || 1;
      prices[item._id] *= itemSpecificPriceMultiplier;
    });

    // Typescript hack to call protected method
    (ragfairPriceService as any).generateDynamicPrices();
    ragfairOfferGenerator.generateDynamicOffers().then(() => {
      this.logger.success(`${this.modName}: Success! Found ${blacklistedItemsCount} blacklisted items to update.`);
    });
  }

  private getUpdatedPrice(item: ITemplateItem, prices: Record<string, number>): number | undefined {
    // Note that this price can be affected by other mods like Lua's market updater.
    const currentFleaPrice = prices[item._id];
    let newPrice: number;

    if (item._props.ammoType === "bullet") {
      newPrice = this.getUpdatedAmmoPrice(item);
    } else if (Number(item._props.armorClass) > 0 && item._props.armorZone?.some(zone => zone === "Chest")) {
      newPrice = this.getUpdatedArmourPrice(item, prices);
    }

    // Avoids NaN. Also we shouldn't have any prices of 0.
    const price = newPrice || currentFleaPrice;
    return price && price * config.blacklistedItemPriceMultiplier;
  }

  private getUpdatedAmmoPrice(item: ITemplateItem) {
    const baselinePen = this.baselineBullet._props.PenetrationPower;
    const baselineDamage = this.baselineBullet._props.Damage;

    const penetrationMultiplier = item._props.PenetrationPower / baselinePen;
    const baseDamageMultiplier = item._props.Damage / baselineDamage;

    // Reduces the effect of the damage multiplier so high DMG rounds aren't super expensive.
    // Eg. let baseDamageMultiplier = 2 & bulletDamageMultiplierRedutionFactor = 0.7. Instead of a 2x price when a bullet is 2x damage, we instead get:
    // 2 + (1 - 2) * 0.7 = 2 - 0.7 = 1.3x the price.
    const damageMultiplier = baseDamageMultiplier + (1 - baseDamageMultiplier) * advancedConfig.bulletDamageMultiplierRedutionFactor; 

    return advancedConfig.baselineBulletPrice * penetrationMultiplier * damageMultiplier * config.blacklistedAmmoAdditionalPriceMultiplier;
  }

  // Armour price balancing is tricky. The default prices for some armours like the Zabralo is too high imo.
  // Updated prices are based on a Trooper armour (default) as well as the armour class and its weight.
  private getUpdatedArmourPrice(item: ITemplateItem, prices: Record<string, number>) {
    const baselineArmourRating = Number(this.baselineArmour._props.armorClass);
    const baselineArmourPrice = prices[this.baselineArmour._id];

    const itemArmourRatingMultiplier = Number(item._props.armorClass) / baselineArmourRating;
    const itemArmourWeightMultiplier = advancedConfig.baselineArmourWeight / item._props.Weight;
    // Hard to balance this figure so will just leave it out.
    // const partialItemCost = prices[item._id] * (advancedConfig.percentageOfInitialArmourPriceToAdd / 100)

    return baselineArmourPrice * itemArmourRatingMultiplier * itemArmourWeightMultiplier * config.blacklistedArmourAdditionalPriceMultiplier;
  }

  private debug(message: string) {
    if (advancedConfig.enableDebug) {
      this.logger.debug(`${this.modName}: ${message}`);
    }
  }
}

module.exports = { mod: new TheBlacklistMod() };
