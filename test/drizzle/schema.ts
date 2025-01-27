import { createEventsTable, createProjectionBaseClasssTable } from "../../dist";

export const exampleAppEvents = createEventsTable({
    schema: "example_app",
    name: "events",
    dataIndexes: [
        "listId",
        "itemId",
    ],
});

export const exampleAppProjections = createProjectionBaseClasssTable({
    schema: "example_app",
    name: "views",
    dataIndexes: [
        "listId",
        "itemId",
    ],
});
