export enum ExampleAppEventTypes {
    LIST_CREATED = "LIST_CREATED",
    LIST_DELETED = "LIST_DELETED",
    ITEM_ADDED = "ITEM_ADDED",
    ITEM_REMOVED = "ITEM_REMOVED",
    ITEM_COMPLETED = "ITEM_COMPLETED",
    ITEM_UNCOMPLETED = "ITEM_UNCOMPLETED",
}

export type ExampleAppEventBase = {
    type: ExampleAppEventTypes;
    data: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    id: string;
};
