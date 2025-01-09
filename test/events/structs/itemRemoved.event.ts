import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ItemRemovedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.ITEM_REMOVED;
  data: {
    listId: string;
    itemId: string;
  };
} 