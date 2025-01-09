import { ExampleAppEventTypes } from "../../events";

import { ExampleAppEvent } from "../../events";

export const toIncompleteItems = (
  incompleteItems: string[],
  event: ExampleAppEvent
) => {
  switch (event.type) {
    case ExampleAppEventTypes.ITEM_COMPLETED: {
      const next = new Set(incompleteItems);
      next.delete(event.data.itemId);
      return Array.from(next);
    }
    case ExampleAppEventTypes.ITEM_UNCOMPLETED: {
      const next = new Set(incompleteItems);
      next.add(event.data.itemId);
      return Array.from(next);
    }
    default:
      return incompleteItems;
  }
};
