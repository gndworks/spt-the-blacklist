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
    (memo, category) => memo.concat(getChildCategoriesRecursively(handbookCategories, category.Id)), 
    []
  );

  return childCategories.concat(grandChildrenCategories);
}

export function isBulletOrShotgunShell(item: ITemplateItem): boolean {
  const props = item._props;

  return props.ammoType === "bullet" || props.ammoType === "buckshot";
}