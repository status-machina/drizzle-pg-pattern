import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ItemUncompletedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.ITEM_UNCOMPLETED;
  data: {
    listId: string;
    itemId: string;
  };
} 