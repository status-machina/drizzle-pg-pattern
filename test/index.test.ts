import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ExampleAppEventTypes, getEventClient } from "./events";
import { TodoListProjection } from "./projections/todoList/todoList.projection";
import { ExampleAppEventInput } from "./events";
import { ulid } from "ulidx";
import { setupTestDatabase, teardownTestDatabase } from "./drizzle/db";
import { ItemAddedEvent } from "./events/structs/itemAdded.event";
import { TodoListWithMetaProjection } from "./projections/todoList/todoListWithMeta.projection";

describe("Event Sourcing", () => {
  let eventClient: ReturnType<typeof getEventClient>;

  beforeAll(async () => {
    await setupTestDatabase();
    eventClient = getEventClient();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDatabase();
  });

  const getTestEvents = () => {
    const listId = ulid();
    const itemId = ulid();
    const events: ExampleAppEventInput[] = [
      {
        type: ExampleAppEventTypes.LIST_CREATED,
        data: {
          listId,
          listName: "Test List",
        },
      },
      {
        type: ExampleAppEventTypes.ITEM_ADDED,
        data: {
          listId,
          itemId,
          itemName: "Test Item",
        },
      },
      {
        type: ExampleAppEventTypes.ITEM_COMPLETED,
        data: {
          listId,
          itemId,
        },
      },
    ];
    return { events, listId, itemId };
  };

  it("should save and retrieve events", async () => {
    const { events } = getTestEvents();
    const savedEvents = await eventClient.saveEvents(events);
    expect(savedEvents).toHaveLength(3);
    const [
      { type: firstType, id: firstId },
      { type: secondType, id: secondId },
      { type: thirdType, id: thirdId },
    ] = savedEvents;
    expect(firstType).toBe(ExampleAppEventTypes.LIST_CREATED);
    expect(secondType).toBe(ExampleAppEventTypes.ITEM_ADDED);
    expect(thirdType).toBe(ExampleAppEventTypes.ITEM_COMPLETED);
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(thirdId).toBeDefined();
  });

  it("should retrieve events by type and data", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);

    const listEvents = await eventClient.getEventStream(
      [ExampleAppEventTypes.LIST_CREATED],
      {
        data: { listId },
      }
    );
    expect(listEvents).toHaveLength(1);
    expect(listEvents[0].type).toBe(ExampleAppEventTypes.LIST_CREATED);

    const itemEvents = await eventClient.getEventStream(
      [ExampleAppEventTypes.ITEM_ADDED, ExampleAppEventTypes.ITEM_COMPLETED],
      { data: { itemId } }
    );

    expect(itemEvents).toHaveLength(2);
    expect(itemEvents[0].type).toBe(ExampleAppEventTypes.ITEM_ADDED);
    expect(itemEvents[1].type).toBe(ExampleAppEventTypes.ITEM_COMPLETED);
  });

  it("should retrieve and merge multiple event streams", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);

    const streams = [
      {
        eventTypes: [ExampleAppEventTypes.LIST_CREATED],
        options: { data: { listId } }
      },
      {
        eventTypes: [ExampleAppEventTypes.ITEM_ADDED, ExampleAppEventTypes.ITEM_COMPLETED],
        options: { data: { itemId } }
      }
    ];

    const mergedEvents = await eventClient.getEventStreams(streams);

    expect(mergedEvents).toHaveLength(3);
    expect(mergedEvents[0].type).toBe(ExampleAppEventTypes.LIST_CREATED);
    expect(mergedEvents[1].type).toBe(ExampleAppEventTypes.ITEM_ADDED);
    expect(mergedEvents[2].type).toBe(ExampleAppEventTypes.ITEM_COMPLETED);
  });

  it("should build projection from events", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);

    const projection = new TodoListProjection(listId, eventClient);
    const view = await projection.asJson();

    expect(view.items).toHaveLength(0);
    expect(view.completedItems).toHaveLength(1);
    expect(view.completedItems[0]).toBe(itemId);
  });

  it("should save and load projection", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);

    const projection = new TodoListProjection(listId, eventClient);
    await projection.saveProjection();

    const loadedProjection = new TodoListProjection(listId, eventClient);
    const view = await loadedProjection.asJson();

    expect(view.items).toHaveLength(0);
    expect(view.completedItems).toHaveLength(1);
    expect(view.completedItems[0]).toBe(itemId);
  });

  it("should update projection with new events", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);
    const projection = new TodoListProjection(listId, eventClient);
    await projection.saveProjection();

    // Add new event
    await eventClient.saveEvent({
      type: ExampleAppEventTypes.ITEM_UNCOMPLETED,
      data: {
        listId,
        itemId,
      },
    });

    // Load projection and verify it includes new event
    const loadedProjection = new TodoListProjection(listId, eventClient);
    const view = await loadedProjection.asJson();

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toBe(itemId);
    expect(view.completedItems).toHaveLength(0);
  });

  it("should combine list and item events in multi-stream projection", async () => {
    const { events, listId, itemId } = getTestEvents();
    await eventClient.saveEvents(events);

    const projection = new TodoListWithMetaProjection(listId, eventClient);
    const view = await projection.asJson();

    expect(view.listName).toBe("Test List");
    expect(view.isDeleted).toBe(false);
    expect(view.items).toHaveLength(0);
    expect(view.completedItems).toHaveLength(1);
    expect(view.completedItems[0]).toBe(itemId);

    // Delete the list
    await eventClient.saveEvent({
      type: ExampleAppEventTypes.LIST_DELETED,
      data: { listId }
    });

    const updatedProjection = new TodoListWithMetaProjection(listId, eventClient);
    const updatedView = await updatedProjection.asJson();
    expect(updatedView.isDeleted).toBe(true);
    expect(updatedView.items).toHaveLength(0);
    expect(updatedView.completedItems).toHaveLength(1);
  });

  describe("Event Stream Validation", () => {
    it("should save event when no newer events exist", async () => {
      const { events, listId, itemId } = getTestEvents();
      const [savedEvent] = await eventClient.saveEvents([events[0]]);

      const result = await eventClient.saveEventWithStreamValidation(
        events[1],
        savedEvent.id,
        [
          {
            types: [
              ExampleAppEventTypes.ITEM_ADDED,
              ExampleAppEventTypes.ITEM_COMPLETED,
            ],
            identifier: { listId },
          },
        ]
      );

      expect(result).toBeDefined();
      expect(result.type).toBe(ExampleAppEventTypes.ITEM_ADDED);
      expect((result.data as ItemAddedEvent['data']).itemId).toBe(itemId);
    });

    it("should reject event when newer events exist", async () => {
      const { events, listId } = getTestEvents();
      const [firstEvent, secondEvent] = await eventClient.saveEvents([
        events[0],
        events[1],
      ]);

      await expect(
        eventClient.saveEventWithStreamValidation(
          events[2],
          firstEvent.id,
          [
            {
              types: [
                ExampleAppEventTypes.ITEM_ADDED,
                ExampleAppEventTypes.ITEM_COMPLETED,
              ],
              identifier: { listId },
            },
          ]
        )
      ).rejects.toThrow("Concurrent modification detected");
    });

    it("should validate multiple streams", async () => {
      const { events, listId } = getTestEvents();
      const [savedEvent] = await eventClient.saveEvents([events[0]]);

      // Try to add item to deleted list
      const archivedEvent = {
        type: ExampleAppEventTypes.LIST_DELETED,
        data: { listId },
      } as const;

      await expect(
        eventClient.saveEventWithStreamValidation(
          events[1],
          savedEvent.id,
          [
            {
              // Check list events
              types: [
                ExampleAppEventTypes.LIST_CREATED,
                ExampleAppEventTypes.LIST_DELETED,
              ],
              identifier: { listId },
            },
            {
              // Check item events
              types: [
                ExampleAppEventTypes.ITEM_ADDED,
                ExampleAppEventTypes.ITEM_COMPLETED,
              ],
              identifier: { listId },
            },
          ]
        )
      ).resolves.toBeDefined();

      // Archive the list
      await eventClient.saveEvent(archivedEvent);

      // Try to add another item after archival
      await expect(
        eventClient.saveEventWithStreamValidation(
          {
            type: ExampleAppEventTypes.ITEM_ADDED,
            data: { listId, itemId: ulid(), itemName: "New Item" },
          },
          savedEvent.id,
          [
            {
              types: [
                ExampleAppEventTypes.LIST_CREATED,
                ExampleAppEventTypes.LIST_DELETED,
              ],
              identifier: { listId },
            },
            {
              types: [
                ExampleAppEventTypes.ITEM_ADDED,
                ExampleAppEventTypes.ITEM_COMPLETED,
              ],
              identifier: { listId },
            },
          ]
        )
      ).rejects.toThrow("Concurrent modification detected");
    });
  });
});
