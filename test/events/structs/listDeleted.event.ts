import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ListDeletedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.LIST_DELETED;
  data: {
    listId: string;
  };
} 