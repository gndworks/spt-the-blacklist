// Copyright (C) 2024 Platinum
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

import { Category } from "@spt-aki/models/eft/common/tables/IHandbookBase";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";

import config from "../config.json";
import advancedConfig from "../advancedConfig.json";

// There are so many child categories of attachments, this will return all categories using recursion so I don't have to type each ID.
export function getAttachmentCategoryIds(handbookCategories: Category[]): string[] {
  const weaponPartsAndModsId = "5b5f71a686f77447ed5636ab";
  const weaponPartsChildrenCategories = getChildCategoriesRecursively(handbookCategories, weaponPartsAndModsId);
  const childrenIds = weaponPartsChildrenCategories.map(category => category.Id);
  const attachmentCategoryIds = [weaponPartsAndModsId];

  return attachmentCategoryIds.concat(childrenIds);
}

function getChildCategoriesRecursively(handbookCategories: Category[], parentId: string): Category[] {
  const childCategories = handbookCategories.filter(category => category.ParentId === parentId);
  const grandChildrenCategories = childCategories.reduce(
    (memo, category) => memo.concat(this.getChildCategoriesRecursively(handbookCategories, category.Id)), 
    []
  );

  return childCategories.concat(grandChildrenCategories);
}

export function isBulletOrShotgunShell(item: ITemplateItem): boolean {
  const props = item._props;

  return props.ammoType === "bullet" || props.ammoType === "buckshot";
}

export function getUpdatedAmmoPrice(item: ITemplateItem): number {
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
  const damageMultiplier = baseDamageMultiplier + (1 - baseDamageMultiplier) * advancedConfig.bulletDamageMultiplierRedutionFactor; 

  return advancedConfig.baselineBulletPrice * penetrationMultiplier * damageMultiplier * config.blacklistedAmmoAdditionalPriceMultiplier;
}