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

class TheBlacklistMod implements IPostDBLoadMod {
  private logger: ILogger;

  private modName = "[The Blacklist]";

  // We to adjust for pricing using a baseline when mods like SPT Realism are used
  private baselineBullet: ITemplateItem;
  private baselineArmour: ITemplateItem;


  public postDBLoad(container: DependencyContainer): void {
    this.logger = container.resolve<ILogger>("WinstonLogger");

    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    const tables = databaseServer.getTables();

    const configServer = container.resolve<ConfigServer>("ConfigServer");
    const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);
    const ragfairServer = container.resolve<RagfairServer>("RagfairServer");
    const ragfairPriceService = container.resolve<RagfairPriceService>("RagfairPriceService");
    const ragfairOfferGenerator = container.resolve<RagfairOfferGenerator>("RagfairOfferGenerator");

    // Easiest way to make mod compatible with Lua's flea updater is let the user choose when to load the mod...
    setTimeout(() => this.initialiseMod(tables, ragfairConfig, ragfairServer, ragfairPriceService, ragfairOfferGenerator), config.startDelayInSeconds * 1000);
  }

  private initialiseMod(
    tables: IDatabaseTables, 
    ragfairConfig: IRagfairConfig, 
    ragfairServer: RagfairServer,
    ragfairPriceService: RagfairPriceService,
    ragfairOfferGenerator: RagfairOfferGenerator
  ): void {
    const itemTable = tables.templates.items;
    const handbookItems = tables.templates.handbook.Items;

    ragfairConfig.dynamic.blacklist.enableBsgList = !config.disableBsgBlacklist;

    this.baselineBullet = itemTable[advancedConfig.baselineBulletId];
    this.baselineArmour = itemTable[advancedConfig.baselineArmourId];

    let blacklistedItemsCount = 0;

    handbookItems.forEach(handbookItem => {
      const item = itemTable[handbookItem.Id];
      const itemProps = item._props;
      const prices = tables.templates.prices;

      if (!itemProps.CanSellOnRagfair) {
        if (!prices[item._id]) {
          this.logger.warning(`[${this.modName}] Could not find flea prices for ${item._id} - ${item._name}`);
          prices[item._id] = advancedConfig.defaultPriceWhenPriceDoesntExist;
        }
        const itemSpecificPriceMultiplier = config.customItemPriceMultipliers.find(conf => conf.itemId === item._id)?.priceMultiplier || 1;
        prices[item._id] *= config.blacklistedItemPriceMultiplier * itemSpecificPriceMultiplier;
        itemProps.CanSellOnRagfair = config.canSellBlacklistedItemsOnFlea;

        this.updateAmmoPrices(item, prices);
        this.updateArmourPrices(item, prices);

        blacklistedItemsCount++;
      }
    });

    // Typescript hack to call protected method
    (ragfairPriceService as any).generateDynamicPrices();
    ragfairOfferGenerator.generateDynamicOffers().then(() => {
      this.logger.success(`${this.modName}: Success! Found ${blacklistedItemsCount} blacklisted items to update.`);
    });
  }

  private updateAmmoPrices(item: ITemplateItem, prices: Record<string, number>) {
    if (item._props.ammoType === "bullet") {
      // Note that this price can be affected by other mods like Lua's market updater and the global price multiplier already.
      const currentFleaPrice = prices[item._id];

      prices[item._id] = this.getUpdatedAmmoPrice(item, currentFleaPrice);
    }
  }

  private getUpdatedAmmoPrice(item: ITemplateItem, currentFleaPrice: number) {
    const baselinePen = this.baselineBullet._props.PenetrationPower;

    return currentFleaPrice * config.blacklistedAmmoAdditionalPriceMultiplier * item._props.PenetrationPower / baselinePen;
  }

  private updateArmourPrices(item: ITemplateItem, prices: Record<string, number>) {
    if (Number(item._props.armorClass) > 0) {

      prices[item._id] = this.getUpdatedArmourPrice(item, prices);
    }
  }

  // Armour price balancing is tricky. The default values for some armours like the Zabralo is too high imo.
  // Updated prices are based on a Trooper armour (default) as well as the armour class and its weight.
  private getUpdatedArmourPrice(item: ITemplateItem, prices: Record<string, number>) {
    const baselineArmourRating = Number(this.baselineArmour._props.armorClass);
    const baselineArmourPrice = prices[this.baselineArmour._id];
    const itemArmourRating = Number(item._props.armorClass);
    const itemArmourRatingMultiplier = itemArmourRating / baselineArmourRating;
    const itemArmourWeightMultiplier = advancedConfig.baselineArmourWeight / item._props.Weight;
    const partialItemCost = prices[item._id] * (advancedConfig.percentageOfInitialArmourPriceToAdd / 100)

    return baselineArmourPrice * config.blacklistedArmourAdditionalPriceMultiplier * itemArmourRatingMultiplier * itemArmourWeightMultiplier + partialItemCost;
  }
}

module.exports = { mod: new TheBlacklistMod() };
