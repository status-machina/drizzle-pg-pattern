import { ListCreatedEvent } from "./structs/listCreated.event";
import { ListDeletedEvent } from "./structs/listDeleted.event";
import { ItemAddedEvent } from "./structs/itemAdded.event";
import { ItemRemovedEvent } from "./structs/itemRemoved.event";
import { ItemCompletedEvent } from "./structs/itemCompleted.event";
import { ItemUncompletedEvent } from "./structs/itemUncompleted.event";
import { InputOf } from "../../dist";
import { ExampleAppEventTypes } from "./eventBase";
import { createEventClient } from "../../dist";
import { exampleAppEvents, exampleAppProjections } from '../drizzle/schema'
import { db } from "../drizzle/db";

export { ExampleAppEventTypes } from "./eventBase";

export type ExampleAppDb = typeof db;

export type ExampleAppEvent = |
  ListCreatedEvent | 
  ListDeletedEvent | 
  ItemAddedEvent | 
  ItemRemovedEvent | 
  ItemCompletedEvent | 
  ItemUncompletedEvent;

export type ExampleAppEventInput = 
  InputOf<ExampleAppEvent>;

// Create a function to get the event client with the current db instance
export const getEventClient = () => {
  return createEventClient<
    ExampleAppEventTypes,
    ExampleAppEvent,
    Record<string, unknown>,
    any,
    ExampleAppDb
  >(db, exampleAppEvents, exampleAppProjections);
};
