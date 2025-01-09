import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ItemAddedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.ITEM_ADDED;
  data: {
    listId: string;
    itemId: string;
    itemName: string;
  };
} 