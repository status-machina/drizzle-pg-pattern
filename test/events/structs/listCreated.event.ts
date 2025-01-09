import { ExampleAppEventBase, ExampleAppEventTypes } from "../eventBase";

export interface ListCreatedEvent extends ExampleAppEventBase {
  type: ExampleAppEventTypes.LIST_CREATED;
  data: {
    listId: string;
    listName: string;
  };
} 