import { createMultiStreamProjectionBaseClass } from "../../../dist";
import { ExampleAppEvent, ExampleAppEventTypes, getEventClient } from "../../events";
import { toCompletedItems } from "./to.completedItems";
import { toIncompleteItems } from "./to.incompleteItems";

type TodoListWithMetaView = {
  listName: string;
  isDeleted: boolean;
  items: string[];
  completedItems: string[];
};

const Projection = <T extends Record<string, unknown>>() => createMultiStreamProjectionBaseClass<
  ExampleAppEventTypes,
  ExampleAppEvent,
  ReturnType<typeof getEventClient>,
  T
>();

export class TodoListWithMetaProjection extends Projection<TodoListWithMetaView>() {
  protected get projectionType() {
    return "TODO_LIST_WITH_META";
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

  protected getStreamOptions() {
    return [
      {
        eventTypes: [
          ExampleAppEventTypes.LIST_CREATED,
          ExampleAppEventTypes.LIST_DELETED,
        ],
        options: { data: { listId: this.listId } }
      },
      {
        eventTypes: [
          ExampleAppEventTypes.ITEM_ADDED,
          ExampleAppEventTypes.ITEM_REMOVED,
          ExampleAppEventTypes.ITEM_COMPLETED,
          ExampleAppEventTypes.ITEM_UNCOMPLETED,
        ],
        options: { data: { listId: this.listId } }
      }
    ];
  }

  private async getListMeta() {
    return this.reduceEvents(
      (acc, event) => {
        switch (event.type) {
          case ExampleAppEventTypes.LIST_CREATED:
            return { ...acc, listName: event.data.listName };
          case ExampleAppEventTypes.LIST_DELETED:
            return { ...acc, isDeleted: true };
          default:
            return acc;
        }
      },
      { listName: "", isDeleted: false }
    );
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

  public async asJson(): Promise<TodoListWithMetaView> {
    const meta = await this.getListMeta();
    return {
      ...meta,
      items: await this.incompleteItems(),
      completedItems: await this.completedItems(),
    };
  }
} 