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

  it("should query projections by type and data", async () => {
    const { events: events1, listId: listId1 } = getTestEvents();
    const { events: events2, listId: listId2 } = getTestEvents();
    await eventClient.saveEvents([...events1, ...events2]);

    const projection1 = new TodoListProjection(listId1, eventClient);
    const projection2 = new TodoListProjection(listId2, eventClient);
    await projection1.saveProjection();
    await projection2.saveProjection();

    // Query by type only
    const allTodoLists = await eventClient.queryProjections({
      type: "TODO_LIST"
    });
    expect(allTodoLists.length).toBeGreaterThanOrEqual(2);
    expect(allTodoLists.map(l => l.data.listId)).toContain(listId1);
    expect(allTodoLists.map(l => l.data.listId)).toContain(listId2);

    // Query by type and data
    const specificList = await eventClient.queryProjections<TodoListProjection>({
      type: "TODO_LIST",
      data: { listId: listId1 }
    });
    expect(specificList).toHaveLength(1);
    expect(specificList[0].data.items).toHaveLength(0);

    // Query that should return no results
    const emptyResult = await eventClient.queryProjections({
      type: "TODO_LIST",
      data: { listId: "non-existent-id" }
    });
    expect(emptyResult).toHaveLength(0);

    const twoLists = await eventClient.queryProjections({
      type: "TODO_LIST",
      data: { listId: [listId1, listId2] }
    });
    expect(twoLists).toHaveLength(2);
    expect(twoLists.map(l => l.data.listId)).toContain(listId1);
    expect(twoLists.map(l => l.data.listId)).toContain(listId2);
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

  it("should respect forceUpdate when saving projections", async () => {
    const { events, listId } = getTestEvents();
    const [firstEvent, secondEvent] = await eventClient.saveEvents([events[0], events[1]]);

    // Save initial projection
    await eventClient.saveProjection({
      type: "TEST_PROJECTION",
      id: listId,
      data: { version: 1 },
      latestEventId: secondEvent.id,
    });

    // Try to update with older event ID - should be skipped
    const skipResult = await eventClient.saveProjection({
      type: "TEST_PROJECTION",
      id: listId,
      data: { version: 1 },
      latestEventId: firstEvent.id,
    });
    expect(skipResult.status).toBe("skipped");
    expect((skipResult.data as { version: number }).version).toBe(1);

    // Force update with older event ID - should succeed
    const forceResult = await eventClient.saveProjection({
      type: "TEST_PROJECTION",
      id: listId,
      data: { version: 2 },
      latestEventId: firstEvent.id,
      forceUpdate: true,
    });
    expect(forceResult.status).toBe("updated");
    expect((forceResult.data as { version: number }).version).toBe(2);
  });

  it("should respect forceUpdate through projection classes", async () => {
    const { events, listId, itemId } = getTestEvents();
    const [firstEvent, secondEvent] = await eventClient.saveEvents([events[0], events[1]]);

    // Create and save initial projection
    const projection = new TodoListProjection(listId, eventClient);
    const initialSave = await projection.saveProjection();
    expect(initialSave.status).toBe("created");

    // Create new projection with only first event
    const oldProjection = new TodoListProjection(listId, eventClient);
    oldProjection.fromHistory([firstEvent]);
    
    // Try to save without force - should be skipped
    const skipSave = await oldProjection.saveProjection();
    expect(skipSave.status).toBe("skipped");

    // Try to save with force - should update
    oldProjection.fromHistory([firstEvent]);
    const forceSave = await oldProjection.saveProjection(true);
    expect(forceSave.status).toBe("updated");
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

  describe("Projection Dirty State", () => {
    it("should correctly identify dirty state", async () => {
      const { events, listId } = getTestEvents();
      await eventClient.saveEvents([events[0], events[1]]);

      // New projection should be dirty
      const projection = new TodoListProjection(listId, eventClient);
      expect(await projection.isDirty()).toBe(true);

      // After saving, should not be dirty (events are cleared)
      await projection.saveProjection();
      expect(await projection.isDirty()).toBe(false);

      // After refresh, should be dirty again (new events found)
      await eventClient.saveEvent(events[2]);
      projection.refresh();
      expect(await projection.isDirty()).toBe(true);

      // New projection with no events should not be dirty
      const emptyProjection = new TodoListProjection(ulid(), eventClient);
      expect(await emptyProjection.isDirty()).toBe(false);
    });

    it("should refresh projection state", async () => {
      const { events, listId } = getTestEvents();
      await eventClient.saveEvent(events[0]);

      // Create and save initial projection
      const projection = new TodoListProjection(listId, eventClient);
      const initialView = await projection.asJson();
      console.log("initialView", initialView);
      expect(initialView.items).toHaveLength(0);
      expect(initialView.completedItems).toHaveLength(0);

      // Add new event - projection should not see it yet
      await eventClient.saveEvent(events[1]);
      const cachedView = await projection.asJson();
      expect(cachedView.items).toHaveLength(0);
      expect(cachedView.completedItems).toHaveLength(0);

      // After refresh, projection should see new event
      const refreshedView = await projection.refresh().asJson();
      console.log("refreshedView", refreshedView);
      expect(refreshedView.items).toHaveLength(1);
      expect(refreshedView.completedItems).toHaveLength(0);

      // Should work with multi-stream projections too
      const multiProjection = new TodoListWithMetaProjection(listId, eventClient);
      await multiProjection.asJson(); // Cache initial state
      await eventClient.saveEvent(events[2]);
      
      const cachedMultiView = await multiProjection.asJson();
      expect(cachedMultiView.completedItems).toHaveLength(0);
      
      const refreshedMultiView = await multiProjection.refresh().asJson();
      expect(refreshedMultiView.completedItems).toHaveLength(1);
    });

    it("should save only when dirty", async () => {
      const { events, listId } = getTestEvents();
      await eventClient.saveEvents(events);

      // Should save when dirty
      const projection = new TodoListProjection(listId, eventClient);
      const wasSaved = await projection.saveIfDirty();
      expect(wasSaved).toBe(true);

      // Should not save when not dirty
      const emptyProjection = new TodoListProjection(ulid(), eventClient);
      const wasEmptySaved = await emptyProjection.saveIfDirty();
      expect(wasEmptySaved).toBe(false);
    });

    it("should work with multi-stream projections", async () => {
      const { events, listId } = getTestEvents();
      await eventClient.saveEvents([events[0]]);

      // Should be dirty with events
      const projection = new TodoListWithMetaProjection(listId, eventClient);
      expect(await projection.isDirty()).toBe(true);
      const wasSaved = await projection.saveIfDirty();
      expect(wasSaved).toBe(true);

      // Should not be dirty without events
      const emptyProjection = new TodoListWithMetaProjection(ulid(), eventClient);
      expect(await emptyProjection.isDirty()).toBe(false);
      const wasEmptySaved = await emptyProjection.saveIfDirty();
      expect(wasEmptySaved).toBe(false);
    });
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

      const _exampleStreamWithOptionalField = await eventClient.getEventStream(
        [ExampleAppEventTypes.LIST_CREATED],
        {
          data: { "exampleOptionalField": "test" },
        }
      );
      

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
