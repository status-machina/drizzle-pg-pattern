import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ItemAddedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.ITEM_RANKED;
  data: {
    listId: string;
    itemId: string;
    itemRank: number;
  };
}
