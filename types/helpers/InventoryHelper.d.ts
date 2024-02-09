import { ContainerHelper } from "@spt-aki/helpers/ContainerHelper";
import { DialogueHelper } from "@spt-aki/helpers/DialogueHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { PaymentHelper } from "@spt-aki/helpers/PaymentHelper";
import { PresetHelper } from "@spt-aki/helpers/PresetHelper";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { TraderAssortHelper } from "@spt-aki/helpers/TraderAssortHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { Inventory } from "@spt-aki/models/eft/common/tables/IBotBase";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { IAddItemDirectRequest } from "@spt-aki/models/eft/inventory/IAddItemDirectRequest";
import { AddItem } from "@spt-aki/models/eft/inventory/IAddItemRequestData";
import { IAddItemTempObject } from "@spt-aki/models/eft/inventory/IAddItemTempObject";
import { IAddItemsDirectRequest } from "@spt-aki/models/eft/inventory/IAddItemsDirectRequest";
import { IInventoryMergeRequestData } from "@spt-aki/models/eft/inventory/IInventoryMergeRequestData";
import { IInventoryMoveRequestData } from "@spt-aki/models/eft/inventory/IInventoryMoveRequestData";
import { IInventoryRemoveRequestData } from "@spt-aki/models/eft/inventory/IInventoryRemoveRequestData";
import { IInventorySplitRequestData } from "@spt-aki/models/eft/inventory/IInventorySplitRequestData";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { IInventoryConfig, RewardDetails } from "@spt-aki/models/spt/config/IInventoryConfig";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { FenceService } from "@spt-aki/services/FenceService";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { HashUtil } from "@spt-aki/utils/HashUtil";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
export interface IOwnerInventoryItems {
    /** Inventory items from source */
    from: Item[];
    /** Inventory items at destination */
    to: Item[];
    sameInventory: boolean;
    isMail: boolean;
}
export declare class InventoryHelper {
    protected logger: ILogger;
    protected jsonUtil: JsonUtil;
    protected hashUtil: HashUtil;
    protected httpResponse: HttpResponseUtil;
    protected fenceService: FenceService;
    protected databaseServer: DatabaseServer;
    protected paymentHelper: PaymentHelper;
    protected traderAssortHelper: TraderAssortHelper;
    protected dialogueHelper: DialogueHelper;
    protected itemHelper: ItemHelper;
    protected containerHelper: ContainerHelper;
    protected profileHelper: ProfileHelper;
    protected presetHelper: PresetHelper;
    protected localisationService: LocalisationService;
    protected configServer: ConfigServer;
    protected inventoryConfig: IInventoryConfig;
    constructor(logger: ILogger, jsonUtil: JsonUtil, hashUtil: HashUtil, httpResponse: HttpResponseUtil, fenceService: FenceService, databaseServer: DatabaseServer, paymentHelper: PaymentHelper, traderAssortHelper: TraderAssortHelper, dialogueHelper: DialogueHelper, itemHelper: ItemHelper, containerHelper: ContainerHelper, profileHelper: ProfileHelper, presetHelper: PresetHelper, localisationService: LocalisationService, configServer: ConfigServer);
    /**
     * Add multiple items to player stash (assuming they all fit)
     * @param sessionId Session id
     * @param request IAddItemsDirectRequest request
     * @param pmcData Player profile
     * @param output Client response object
     */
    addItemsToStash(sessionId: string, request: IAddItemsDirectRequest, pmcData: IPmcData, output: IItemEventRouterResponse): void;
    /**
     * Add whatever is passed in `request.itemWithModsToAdd` into player inventory (if it fits)
     * @param sessionId Session id
     * @param request addItemDirect request
     * @param pmcData Player profile
     * @param output Client response object
     */
    addItemToStash(sessionId: string, request: IAddItemDirectRequest, pmcData: IPmcData, output: IItemEventRouterResponse): void;
    /**
     * Set FiR status for an item + its children
     * @param itemWithChildren An item
     * @param foundInRaid Item was found in raid
     */
    private setFindInRaidStatusForItem;
    /**
     * Remove properties from a Upd object used by a trader/ragfair
     * @param upd Object to update
     */
    protected removeTraderRagfairRelatedUpdProperties(upd: Upd): void;
    canPlaceItemsInInventory(sessionId: string, itemsWithChildren: Item[][]): boolean;
    canPlaceItemInInventory(stashFS2D: number[][], itemWithChildren: Item[]): boolean;
    /**
     * Find a location to place an item into inventory and place it
     * @param stashFS2D 2-dimensional representation of the container slots
     * @param sortingTableFS2D 2-dimensional representation of the sorting table slots
     * @param itemWithChildren Item to place
     * @param playerInventory
     * @param useSortingTable Should sorting table to be used if main stash has no space
     * @param output output to send back to client
     */
    protected placeItemInInventory(stashFS2D: number[][], sortingTableFS2D: number[][], itemWithChildren: Item[], playerInventory: Inventory, useSortingTable: boolean, output: IItemEventRouterResponse): void;
    /**
     * @param assortItems Items to add to inventory
     * @param requestItem Details of purchased item to add to inventory
     * @param result Array split stacks are added to
     */
    protected splitStackIntoSmallerChildStacks(assortItems: Item[], requestItem: AddItem, result: IAddItemTempObject[]): void;
    /**
     * Handle Remove event
     * Remove item from player inventory + insured items array
     * Also deletes child items
     * @param profile Profile to remove item from (pmc or scav)
     * @param itemId Items id to remove
     * @param sessionID Session id
     * @param output Existing IItemEventRouterResponse object to append data to, creates new one by default if not supplied
     * @returns IItemEventRouterResponse
     */
    removeItem(profile: IPmcData, itemId: string, sessionID: string, output?: IItemEventRouterResponse): IItemEventRouterResponse;
    removeItemAndChildrenFromMailRewards(sessionId: string, removeRequest: IInventoryRemoveRequestData, output: IItemEventRouterResponse): void;
    removeItemByCount(pmcData: IPmcData, itemId: string, count: number, sessionID: string, output?: IItemEventRouterResponse): IItemEventRouterResponse;
    getItemSize(itemTpl: string, itemID: string, inventoryItems: Item[]): number[];
    protected getSizeByInventoryItemHash(itemTpl: string, itemID: string, inventoryItemHash: InventoryHelper.InventoryItemHash): number[];
    protected getInventoryItemHash(inventoryItem: Item[]): InventoryHelper.InventoryItemHash;
    getContainerMap(containerW: number, containerH: number, itemList: Item[], containerId: string): number[][];
    /**
     * Return the inventory that needs to be modified (scav/pmc etc)
     * Changes made to result apply to character inventory
     * Based on the item action, determine whose inventories we should be looking at for from and to.
     * @param request Item interaction request
     * @param sessionId Session id / playerid
     * @returns OwnerInventoryItems with inventory of player/scav to adjust
     */
    getOwnerInventoryItems(request: IInventoryMoveRequestData | IInventorySplitRequestData | IInventoryMergeRequestData, sessionId: string): IOwnerInventoryItems;
    /**
     * Made a 2d array table with 0 - free slot and 1 - used slot
     * @param {Object} pmcData
     * @param {string} sessionID
     * @returns Array
     */
    protected getStashSlotMap(pmcData: IPmcData, sessionID: string): number[][];
    protected getSortingTableSlotMap(pmcData: IPmcData): number[][];
    /**
     * Get Player Stash Proper Size
     * @param sessionID Playerid
     * @returns Array of 2 values, x and y stash size
     */
    protected getPlayerStashSize(sessionID: string): Record<number, number>;
    /**
     * Get the players stash items tpl
     * @param sessionID Player id
     * @returns Stash tpl
     */
    protected getStashType(sessionID: string): string;
    /**
     * Internal helper function to transfer an item from one profile to another.
     * @param fromItems Inventory of the source (can be non-player)
     * @param toItems Inventory of the destination
     * @param body Move request
     */
    moveItemToProfile(fromItems: Item[], toItems: Item[], body: IInventoryMoveRequestData): void;
    /**
     * Internal helper function to move item within the same profile_f.
     * @param pmcData profile to edit
     * @param inventoryItems
     * @param moveRequest
     * @returns True if move was successful
     */
    moveItemInternal(pmcData: IPmcData, inventoryItems: Item[], moveRequest: IInventoryMoveRequestData): {
        success: boolean;
        errorMessage?: string;
    };
    /**
     * Update fast panel bindings when an item is moved into a container that doesnt allow quick slot access
     * @param pmcData Player profile
     * @param itemBeingMoved item being moved
     */
    protected updateFastPanelBinding(pmcData: IPmcData, itemBeingMoved: Item): void;
    /**
     * Internal helper function to handle cartridges in inventory if any of them exist.
     */
    protected handleCartridges(items: Item[], body: IInventoryMoveRequestData): void;
    /**
     * Get details for how a random loot container should be handled, max rewards, possible reward tpls
     * @param itemTpl Container being opened
     * @returns Reward details
     */
    getRandomLootContainerRewardDetails(itemTpl: string): RewardDetails;
    getInventoryConfig(): IInventoryConfig;
    /**
     * Recursively checks if the given item is
     * inside the stash, that is it has the stash as
     * ancestor with slotId=hideout
     * @param pmcData Player profile
     * @param itemToCheck Item to look for
     * @returns True if item exists inside stash
     */
    isItemInStash(pmcData: IPmcData, itemToCheck: Item): boolean;
}
declare namespace InventoryHelper {
    interface InventoryItemHash {
        byItemId: Record<string, Item>;
        byParentId: Record<string, Item[]>;
    }
}
export {};
