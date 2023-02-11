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
import { IDatabaseTables } from "@spt-aki/models/spt/server/IDatabaseTables";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { RagfairServer } from "@spt-aki/servers/RagfairServer";
import { IRagfairConfig } from "@spt-aki/models/spt/config/IRagfairConfig";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { RagfairOfferGenerator } from "@spt-aki/generators/RagfairOfferGenerator";
import { RagfairPriceService } from "@spt-aki/services/RagfairPriceService";

import config from "../config.json";
import advancedConfig from "../advancedConfig.json";
import { RagfairOfferService } from "@spt-aki/services/RagfairOfferService";

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

      // We found a custom price override to use. That's all we care about for this item. Move on to the next item.
      if (customItemConfig?.priceOverride) {
        prices[item._id] = customItemConfig.priceOverride;
        return;
      }

      const itemProps = item._props;

      if (!itemProps.CanSellOnRagfair) {
        if (!prices[item._id]) {
          this.logger.debug(`${this.modName} Could not find flea prices for ${item._id} - ${item._name}. Skipping item update.`);
          return;
        }

        itemProps.CanSellOnRagfair = config.canSellBlacklistedItemsOnFlea;

        prices[item._id] = this.getUpdatedPrice(item, prices);

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

  private getUpdatedPrice(item: ITemplateItem, prices: Record<string, number>) {
    // Note that this price can be affected by other mods like Lua's market updater.
    const currentFleaPrice = prices[item._id];
    let newPrice: number;

    if (item._props.ammoType === "bullet") {
      newPrice = this.getUpdatedAmmoPrice(item, currentFleaPrice);
    } else if (Number(item._props.armorClass) > 0) {
      newPrice = this.getUpdatedArmourPrice(item, prices);
    }

    return newPrice ? newPrice * config.blacklistedItemPriceMultiplier : currentFleaPrice;
  }

  private getUpdatedAmmoPrice(item: ITemplateItem, currentFleaPrice: number) {
    const baselinePen = this.baselineBullet._props.PenetrationPower;
    const baselineDamage = this.baselineBullet._props.Damage;

    const penetrationMultiplier = item._props.PenetrationPower / baselinePen;
    const damageMultiplier = item._props.Damage / baselineDamage;

    return currentFleaPrice * config.blacklistedAmmoAdditionalPriceMultiplier * penetrationMultiplier * damageMultiplier;
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

    return baselineArmourPrice * config.blacklistedArmourAdditionalPriceMultiplier * itemArmourRatingMultiplier * itemArmourWeightMultiplier;
  }
}

module.exports = { mod: new TheBlacklistMod() };
