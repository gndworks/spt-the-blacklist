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
import { Category } from "@spt-aki/models/eft/common/tables/IHandbookBase";

import config from "../config.json";
import advancedConfig from "../advancedConfig.json";

class TheBlacklistMod implements IPostDBLoadMod {
  private logger: ILogger;

  private modName = "[The Blacklist]";

  // We to adjust for pricing using a baseline when mods like SPT Realism are used
  private baselineBullet: ITemplateItem;
  private baselineArmour: ITemplateItem;

  // Store the category IDs of all attachments in the handbook so we don't have to manually enter them in json
  private attachmentCategoryIds: string[] = [];

  public postDBLoad(container: DependencyContainer): void {
    this.logger = container.resolve<ILogger>("WinstonLogger");

    // Easiest way to make mod compatible with Lua's flea updater is let the user choose when to load the mod...
    setTimeout(() => this.initialiseMod(container), (advancedConfig.startDelayInSeconds || 7) * 1000);
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
    let attachmentPriceLimitedCount = 0;

    if (config.limitMaxPriceOfAttachments) {
      this.initialiseAttachmentCategoryIds(tables.templates.handbook.Categories);
    }

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

      if (config.limitMaxPriceOfAttachments && this.attachmentCategoryIds.includes(handbookItem.ParentId)) {
        const handbookPrice = handbookItem.Price;
        const existingFleaPrice = prices[item._id];
        const maxFleaPrice = handbookPrice * config.maxFleaPriceOfAttachmentsToHandbookPrice;
        
        if (existingFleaPrice > maxFleaPrice) {
          prices[item._id] = maxFleaPrice;
          attachmentPriceLimitedCount++;
          this.debug(`Attachment ${item._id} - ${item._name} was updated from ${existingFleaPrice} to ${maxFleaPrice}.`)
        }
      }

      const itemProps = item._props;
      if (!itemProps.CanSellOnRagfair) {
        // Some blacklisted items are hard to balance or just shouldn't be allowed so we will keep them blacklisted.
        if (advancedConfig.excludedCategories.some(category => category === handbookItem.ParentId)) {
          ragfairConfig.dynamic.blacklist.custom.push(item._id);
          this.debug(`Blacklisted item ${item._id} - ${item._name} because we are excluding handbook category ${handbookItem.ParentId}.`);
          return;
        }

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
      this.logger.success(`${this.modName}: config.limitMaxPriceOfAttachments is enabled! Updated ${attachmentPriceLimitedCount} flea prices of attachments.`)
    });
  }

  private initialiseAttachmentCategoryIds(handbookCategories: Category[]) {
    const weaponPartsAndModsId = "5b5f71a686f77447ed5636ab";
    const weaponPartsChildrenCategories = this.getChildCategoriesRecursively(handbookCategories, weaponPartsAndModsId);
    const childrenIds = weaponPartsChildrenCategories.map(category => category.Id);

    this.attachmentCategoryIds.push(weaponPartsAndModsId);
    this.attachmentCategoryIds = this.attachmentCategoryIds.concat(childrenIds);
  }

  private getChildCategoriesRecursively(handbookCategories: Category[], parentId: string): Category[] {
    const childCategories = handbookCategories.filter(category => category.ParentId === parentId);
    const grandChildrenCategories = childCategories.reduce(
      (memo, category) => memo.concat(this.getChildCategoriesRecursively(handbookCategories, category.Id)), 
      []
    );
  
    return childCategories.concat(grandChildrenCategories);
  }

  private getUpdatedPrice(item: ITemplateItem, prices: Record<string, number>): number | undefined {
    // Note that this price can be affected by other mods like Lua's market updater.
    const currentFleaPrice = prices[item._id];
    let newPrice: number;

    if (this.isAmmo(item)) {
      newPrice = this.getUpdatedAmmoPrice(item);
    } else if (this.isArmour(item)) {
      newPrice = this.getUpdatedArmourPrice(item);
    } else if (this.isGun(item) && currentFleaPrice == null) {
      newPrice = this.getFallbackGunPrice();
    }

    // Avoids NaN. Also we shouldn't have any prices of 0.
    const price = newPrice || currentFleaPrice;
    return price && price * config.blacklistedItemPriceMultiplier;
  }

  private isAmmo(item: ITemplateItem): boolean {
    const roundsItemCategoryId = "5485a8684bdc2da71d8b4567";
    return item._parent === roundsItemCategoryId;
  }

  private isArmour(item: ITemplateItem): boolean {
    return Number(item._props.armorClass) > 0 && item._props.armorZone?.some(zone => zone === "Chest")
  }

  // Some blacklisted guns are very cheap because they don't have a flea price, just a handbook price. The ones listed below will get a much higher default price.
  private isGun(item: ITemplateItem): boolean {
    const marksmanRiflesItemCategoryId = "5447b6194bdc2d67278b4567";
    const assaultRiflesItemCategoryId = "5447b5f14bdc2d61278b4567";
    const sniperRiflesItemCategoryId = "5447b6254bdc2dc3278b4568";
    const smgsItemCategoryId = "5447b5e04bdc2d62278b4567";
    const carbinesItemCategoryId = "5447b5fc4bdc2d87278b4567";
    const gunCategories = [marksmanRiflesItemCategoryId, assaultRiflesItemCategoryId, sniperRiflesItemCategoryId, smgsItemCategoryId, carbinesItemCategoryId];

    return gunCategories.includes(item._parent);
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

  // Some default armour prices are too high like the Zabralo so I want a more balanced way to calculate the price.
  private getUpdatedArmourPrice(item: ITemplateItem) {
    const baselineArmourClass = Number(this.baselineArmour._props.armorClass);

    // Instead of doing a simple multiplier by dividing the two armour classes, this will give us a much bigger price range for different tiered armours.
    const armourClassCost = (Number(item._props.armorClass) - baselineArmourClass) * advancedConfig.pricePerArmourClassStep;
    const baseArmourWeightMultiplier = advancedConfig.baselineArmourWeight / item._props.Weight;

    // Reduces the effect of the weight multiplier so some lighter armour aren't super expensive.
    // Eg. let baseArmourWeightMultiplier = 2 & armourWeightMultiplierReductionFactor = 0.7. Instead of a 2x price when an armour is half as light as the baseline, we instead get:
    // 2 + (1 - 2) * 0.7 = 2 - 0.7 = 1.3x the price.
    const armourWeightMultiplier = baseArmourWeightMultiplier + (1 - baseArmourWeightMultiplier) * advancedConfig.armourWeightMultiplierReductionFactor;

    return (advancedConfig.baselineArmourPrice + armourClassCost) * armourWeightMultiplier * config.blacklistedArmourAdditionalPriceMultiplier;
  }

  private getFallbackGunPrice() {
    return advancedConfig.gunPriceFallback;
  }

  private debug(message: string) {
    if (advancedConfig.enableDebug) {
      this.logger.debug(`${this.modName}: ${message}`);
    }
  }
}

module.exports = { mod: new TheBlacklistMod() };
