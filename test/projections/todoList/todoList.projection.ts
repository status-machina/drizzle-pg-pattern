import { createProjectionBase, EventClient } from "../../../src";
import { ExampleAppEvent, ExampleAppEventTypes, getEventClient } from "../../events";
import { toCompletedItems } from "./to.completedItems";
import { toIncompleteItems } from "./to.incompleteItems";

const ProjectionBase = createProjectionBase<
  ExampleAppEventTypes,
  ExampleAppEvent,
  EventClient
>();

type TodoListView = {
  items: string[];
  completedItems: string[];
};

export class TodoListProjection extends ProjectionBase<TodoListView> {
  protected get eventTypes() {
    return [
      ExampleAppEventTypes.ITEM_ADDED,
      ExampleAppEventTypes.ITEM_REMOVED,
      ExampleAppEventTypes.ITEM_COMPLETED,
      ExampleAppEventTypes.ITEM_UNCOMPLETED,
    ];
  }

  protected get projectionType() {
    return "TODO_LIST";
  }

  constructor(
    private listId: string,
    protected eventsClient: ReturnType<typeof getEventClient>,
    loadExistingView = true
  ) {
    super(eventsClient, loadExistingView);
  }

  public get id() {
    return this.listId;
  }

  protected getEventIdentifiers() {
    return { listId: this.listId };
  }

  public async incompleteItems() {
    return Array.from(
      await this.reduceEvents(
        toIncompleteItems,
        (await this.savedProjection)?.data.items || []
      )
    );
  }

  public async completedItems() {
    return Array.from(
      await this.reduceEvents(
        toCompletedItems,
        (await this.savedProjection)?.data.completedItems || []
      )
    );
  } 

  public async asJson(): Promise<TodoListView> {
    return {
      items: await this.incompleteItems(),
      completedItems: await this.completedItems(),
    };
  }
}
