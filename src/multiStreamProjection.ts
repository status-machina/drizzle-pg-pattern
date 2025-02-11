import { EventClient } from "./eventDbHelpers";
import { GenericEventBase, GenericEventInput } from "./schemaHelpers";
import {
  EventFromType,
  StreamOptionsForEvents,
} from "./utils";

const isUnsavedEvent = <E extends GenericEventBase<any>>(
  event: E | GenericEventInput<E>
): event is GenericEventInput<E> => {
  return (event as GenericEventInput<E>).id === undefined;
};

export class MultiStreamProjectionBase<
  EventType extends string,
  Event extends GenericEventBase<EventType>,
  Client extends EventClient,
  V extends Record<string, unknown>,
  ET extends EventType = EventType,
  E extends EventFromType<ET, Event> = EventFromType<ET, Event>,
> {
  /** The type of this projection, used to look up the projection in the database */
  protected get projectionType(): string {
      throw new Error("projectionType must be implemented"); 
  }

  protected _events?: Promise<(E | GenericEventInput<E>)[]>;
  protected _stagedEvents: (E | GenericEventInput<E>)[] = [];
  private _savedProjection?: Promise<{ data: V; latestEventId: string } | undefined>;

  constructor(
    protected eventsClient: Client,
    private loadExistingProjection = true
  ) {}

  protected get savedProjection() {
    this._savedProjection ||= this.loadExistingProjection
      ? this.eventsClient.getProjection({
          type: this.projectionType,
          id: this.id,
        })
      : Promise.resolve(undefined);
    return this._savedProjection;
  }

  private async getEventsAfterIdentifiers() {
    const projection = await this.savedProjection;
    const streams = await this.getStreamOptions();
    streams.forEach(stream => {
      if (projection?.latestEventId) {
        stream.options = { ...stream.options, after: projection.latestEventId };
      }
    });
    return this.eventsClient.getEventStreams(streams) as Promise<(E | GenericEventInput<E>)[]>;
  }

  private get events() {
    this._events ||= this.getEventsAfterIdentifiers();
    return this._events!;
  }

  protected async projectionEvents() {
    return (await this.events)
      .concat(this._stagedEvents)
      .sort((a, b) => (a.id ?? "") < (b.id ?? "") ? -1 : 1);
  }

  /** Stage events without saving them to the database */
  public apply(events: GenericEventInput<E>[]) {
    this._stagedEvents.push(...events);
    return this;
  }

  /** Replace internal events array without affecting database */
  public fromHistory(events: E[]) {
    this._events = Promise.resolve(events);
    return this;
  }

  /** Clear cached events and projection to force fresh data on next access */
  public refresh(): this {
    this._events = undefined;
    this._savedProjection = undefined;
    this._stagedEvents = [];
    return this;
  }

  /** Reduce events with a custom reducer function */
  protected async reduceEvents<T>(
    reducer: (acc: T, event: E | GenericEventInput<E>) => T,
    initialValue: T
  ): Promise<T> {
    return (await this.projectionEvents()).reduce(reducer, initialValue);
  }

  /** Check if there are events to save */
  public async isDirty(): Promise<boolean> {
    const events = await this.projectionEvents();
    return events?.length > 0;
  }

  /** Save the projection only if it has events to save, returns true if saved */
  public async saveIfDirty(overwrite = false): Promise<boolean> {
    if (await this.isDirty()) {
      await this.saveProjection(overwrite);
      return true;
    }
    return false;
  }

  /** Save the projection to the database */
  public async saveProjection(overwrite = false) {
    const unsavedEvents = this._stagedEvents.filter(isUnsavedEvent);
    if (unsavedEvents.length > 0) {
      throw new Error("Cannot save projection with unpersisted events");
    }

    const events = await this.projectionEvents();
    if (!events?.length && !overwrite) {
      throw new Error("No events to save");
    }

    const latestEventId = events.at(-1)?.id;
    if (latestEventId === undefined) {
      throw new Error("Latest event ID is undefined");
    }
    const result = await this.eventsClient.saveProjection({
      type: this.projectionType,
      id: this.id,
      data: await this.asJson(),
      latestEventId,
      forceUpdate: overwrite,
    });

    // After successful save, clear events since they're now part of the saved projection
    this._events = Promise.resolve([]);
    this._stagedEvents = [];
    return result;
  }

  /** Get a value from the saved projection or return the fallback */
  protected async fromProjectionOrDefault<T>(key: keyof V, fallback: T): Promise<T> {
    const projection = await this.savedProjection;
    if (projection === undefined) return fallback;

    return projection.data[key] as T;
  }

  public get id(): string {
      throw new Error("id must be implemented");
  }

  protected getStreamOptions(): Promise<StreamOptionsForEvents<E, ET>[]> | StreamOptionsForEvents<E, ET>[] {
      throw new Error("getStreamOptions must be implemented");
  }

  public async asJson(): Promise<V> {
      throw new Error("asJson must be implemented");
  }
} 