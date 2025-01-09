import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ItemCompletedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.ITEM_COMPLETED;
  data: {
    listId: string;
    itemId: string;
  };
} 