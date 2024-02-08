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
import { jsonc } from "jsonc";
import path from "path";

import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IPostDBLoadModAsync } from "@spt-aki/models/external/IPostDBLoadModAsync";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { IRagfairConfig } from "@spt-aki/models/spt/config/IRagfairConfig";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { HandbookItem } from "@spt-aki/models/eft/common/tables/IHandbookBase";

import { getAttachmentCategoryIds, isBulletOrShotgunShell } from "./helpers";

class TheBlacklistMod implements IPostDBLoadModAsync {
  private logger: ILogger;

  private modName = "[The Blacklist]";

  // We to adjust for pricing using a baseline when mods like SPT Realism are used
  private baselineBullet: ITemplateItem;

  // Store the category IDs of all attachments in the handbook so we don't have to manually enter them in json
  private attachmentCategoryIds: string[] = [];

  private blacklistedItemsUpdatedCount = 0;
  private attachmentPriceLimitedCount = 0;
  private nonBlacklistedItemsUpdatedCount = 0;
  private ammoPricesUpdatedCount = 0;

  private config;
  private advancedConfig;

  public async postDBLoadAsync(container: DependencyContainer) {
    this.logger = container.resolve<ILogger>("WinstonLogger");
    this.config = await jsonc.read(path.resolve(__dirname, "../config.jsonc"));
    this.advancedConfig = await jsonc.read(path.resolve(__dirname, "../advancedConfig.jsonc"));
    
    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    const tables = databaseServer.getTables();
    const configServer = container.resolve<ConfigServer>("ConfigServer");
    const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);

    const itemTable = tables.templates.items;
    const handbookItems = tables.templates.handbook.Items;
    const prices = tables.templates.prices;

    this.baselineBullet = itemTable[this.advancedConfig.baselineBulletId];

    this.updateRagfairConfig(ragfairConfig);

    if (this.config.limitMaxPriceOfAttachments) {
      this.attachmentCategoryIds = getAttachmentCategoryIds(tables.templates.handbook.Categories);
    }

    // Find all items to update by looping through handbook which is a better indicator of useable items.
    handbookItems.forEach(handbookItem => {
      const item = itemTable[handbookItem.Id];
      const originalPrice = prices[item._id];

      const customItemConfig = this.config.customItemConfigs.find(conf => conf.itemId === item._id);

      // We found a custom item config override to use. That's all we care about for this item. Move on to the next item.
      if (customItemConfig && this.updateItemUsingCustomItemConfig(customItemConfig, item, prices, originalPrice, ragfairConfig)) {
        return;
      }

      if (this.config.limitMaxPriceOfAttachments && this.attachmentCategoryIds.includes(handbookItem.ParentId)) {
        this.updateAttachmentPrice(handbookItem, item, prices);
      }

      const itemProps = item._props;

      if (isBulletOrShotgunShell(item)) {
        this.updateAmmoPrice(item, prices);
      }

      if (!itemProps.CanSellOnRagfair) {
        // Some blacklisted items are hard to balance or just shouldn't be allowed so we will keep them blacklisted.
        if (this.advancedConfig.excludedCategories.some(category => category === handbookItem.ParentId)) {
          ragfairConfig.dynamic.blacklist.custom.push(item._id);
          this.debug(`Ignored item ${item._id} - ${item._name} because we are excluding handbook category ${handbookItem.ParentId}.`);
          return;
        }

        prices[item._id] = this.getUpdatedPrice(handbookItem, item, prices);

        if (!prices[item._id]) {
          this.debug(`There are no flea prices for ${item._id} - ${item._name}!`);
          return;
        }

        if (!isNaN(customItemConfig?.priceMultiplier)) {
          prices[item._id] *= customItemConfig.priceMultiplier;
        }

        this.debug(`Updated ${item._id} - ${item._name} flea price from ${originalPrice} to ${prices[item._id]}.`);

        this.blacklistedItemsUpdatedCount++;
      }
    });

    this.logger.success(`${this.modName}: Success! Found ${this.blacklistedItemsUpdatedCount} blacklisted & ${this.nonBlacklistedItemsUpdatedCount} non-blacklisted items to update.`);
    if (this.config.limitMaxPriceOfAttachments) {
      this.logger.success(`${this.modName}: config.limitMaxPriceOfAttachments is enabled! Updated ${this.attachmentPriceLimitedCount} flea prices of attachments.`);
    }
    if (this.config.useBalancedPricingForAllAmmo) {
      this.logger.success(`${this.modName}: config.useBalancedPricingForAllAmmo is enabled! Updated ${this.ammoPricesUpdatedCount} ammo prices.`);
    }
  }

  private updateRagfairConfig(ragfairConfig: IRagfairConfig) {
    ragfairConfig.dynamic.blacklist.enableBsgList = !this.config.disableBsgBlacklist;

    if (this.advancedConfig.useTraderPriceForOffersIfHigher != null) {
      ragfairConfig.dynamic.useTraderPriceForOffersIfHigher = !!this.advancedConfig.useTraderPriceForOffersIfHigher;
    }

    if (this.config.enableFasterSales && !isNaN(this.advancedConfig.runIntervalSecondsOverride)) {
      ragfairConfig.runIntervalSeconds = this.advancedConfig.runIntervalSecondsOverride;
    }
  }

  // Returns true if we updated something using the customItemConfig so we can skip to the next handbook item.
  private updateItemUsingCustomItemConfig(customItemConfig, item: ITemplateItem , prices: Record<string, number>, originalPrice: number, ragfairConfig: IRagfairConfig): boolean {
    if (customItemConfig?.blacklisted) {
      this.debug(`Blacklisted item ${item._id} - ${item._name} due to its customItemConfig.`);

      ragfairConfig.dynamic.blacklist.custom.push(item._id);

      if (item._props.CanSellOnRagfair) {
        this.nonBlacklistedItemsUpdatedCount++
      }

      return true;
    }

    if (customItemConfig?.fleaPriceOverride) {
      prices[item._id] = customItemConfig.fleaPriceOverride;

      this.debug(`Updated ${item._id} - ${item._name} flea price from ${originalPrice} to ${prices[item._id]} (price override).`);
      
      if (item._props.CanSellOnRagfair) {
        this.nonBlacklistedItemsUpdatedCount++
      }

      return true;
    }

    return false;
  }

  private updateAttachmentPrice(handbookItem: HandbookItem, item: ITemplateItem, prices: Record<string, number>) {
    const handbookPrice = handbookItem.Price;
    const existingFleaPrice = prices[item._id];
    const maxFleaPrice = handbookPrice * this.config.maxFleaPriceOfAttachmentsToHandbookPrice;
    
    if (existingFleaPrice > maxFleaPrice) {
      prices[item._id] = maxFleaPrice;

      this.attachmentPriceLimitedCount++;

      this.debug(`Attachment ${item._id} - ${item._name} was updated from ${existingFleaPrice} to ${maxFleaPrice}.`)
    }
  }

  private updateAmmoPrice(item: ITemplateItem, prices: Record<string, number>) {
    const itemProps = item._props;

    // We don't care about this standard ammo item if we haven't enabled useBalancedPricingForAllAmmo
    if (itemProps.CanSellOnRagfair && !this.config.useBalancedPricingForAllAmmo) {
      return;
    }

    const newPrice = this.getUpdatedAmmoPrice(item);
    prices[item._id] = newPrice;

    if (!itemProps.CanSellOnRagfair) {
      this.blacklistedItemsUpdatedCount++;
    } else {
      this.nonBlacklistedItemsUpdatedCount++;
    }

    this.ammoPricesUpdatedCount++;
  }

  private getUpdatedAmmoPrice(item: ITemplateItem): number {
    const baselinePen = this.baselineBullet._props.PenetrationPower;
    const baselineDamage = this.baselineBullet._props.Damage;
  
    const basePenetrationMultiplier = item._props.PenetrationPower / baselinePen;
    const baseDamageMultiplier = item._props.Damage / baselineDamage;
  
    let penetrationMultiplier: number;
    if (basePenetrationMultiplier > 1) {
      // A good gradient to make higher power rounds more expensive
      penetrationMultiplier = 7 * basePenetrationMultiplier - 6;
    } else {
      // Due to maths above, its really easy to go < 1. The baseline ammo is mid tier with a reasonable 1000 rouble each. Ammo weaker than this tend to be pretty crap so we'll make it much cheaper
      const newMultiplier = basePenetrationMultiplier * 0.7;
      penetrationMultiplier = newMultiplier < 0.1 ? 0.1 : newMultiplier;
    }
  
    // Reduces the effect of the damage multiplier so high DMG rounds aren't super expensive.
    // Eg. let baseDamageMultiplier = 2 & bulletDamageMultiplierRedutionFactor = 0.7. Instead of a 2x price when a bullet is 2x damage, we instead get:
    // 2 + (1 - 2) * 0.7 = 2 - 0.7 = 1.3x the price.
    const damageMultiplier = baseDamageMultiplier + (1 - baseDamageMultiplier) * this.advancedConfig.bulletDamageMultiplierRedutionFactor; 
  
    return this.advancedConfig.baselineBulletPrice * penetrationMultiplier * damageMultiplier * this.config.blacklistedAmmoAdditionalPriceMultiplier;
  }

  private getUpdatedPrice(handbookItem: HandbookItem, item: ITemplateItem, prices: Record<string, number>): number | undefined {
    // If a flea price doesn't exist for an item, we can multiply its handbook price which usually exists.
    if (prices[item._id] == null) {
      const handbookPrice = handbookItem.Price;

      return handbookPrice * this.advancedConfig.handbookPriceMultiplier;
    }

    return prices[item._id] * this.config.blacklistedItemPriceMultiplier;
  }

  private debug(message: string) {
    if (this.advancedConfig.enableDebug) {
      this.logger.debug(`${this.modName}: ${message}`);
    }
  }
}

module.exports = { mod: new TheBlacklistMod() };
