import { createEventsTable, createProjectionsTable } from "../../src/schemaHelpers";

export const exampleAppEvents = createEventsTable({
    schema: "example_app",
    name: "events",
    dataIndexes: [
        "listId",
        "itemId",
    ],
});

export const exampleAppProjections = createProjectionsTable({
    schema: "example_app",
    name: "views",
    dataIndexes: [
        "listId",
        "itemId",
    ],
});
