import { ExampleAppEvent, ExampleAppEventTypes } from "../../events";

export const toCompletedItems = (
  completedItems: string[],
  event: ExampleAppEvent
) => {
  switch (event.type) {
    case ExampleAppEventTypes.ITEM_COMPLETED: {
      const next = new Set(completedItems);
      next.add(event.data.itemId);
      return Array.from(next);
    }
    case ExampleAppEventTypes.ITEM_UNCOMPLETED: {
      const next = new Set(completedItems);
      next.delete(event.data.itemId);
      return Array.from(next);
    }
    default:
      return completedItems;
  }
};
