import { EventClient } from "./eventDbHelpers";
import { GenericEventBase, GenericEventInput } from "./schemaHelpers";
import {
  ObjectWithOnlyStringOrNumberValues,
  ObjectWithOnlyStringOrNumberValuesOrArrayValues,
  EventFromType,
} from "./utils";

const isUnsavedEvent = <E extends GenericEventBase<any>>(
  event: E | GenericEventInput<E>
): event is GenericEventInput<E> => {
  return (event as GenericEventInput<E>).id === undefined;
};

export class ProjectionBase<
  EventType extends string,
  Event extends GenericEventBase<EventType>,
  Client extends EventClient,
  V extends Record<string, unknown>,
  ET extends EventType = EventType,
  E extends EventFromType<ET, Event> = EventFromType<ET, Event>,
  O extends ObjectWithOnlyStringOrNumberValuesOrArrayValues<
    E["data"]
  > = ObjectWithOnlyStringOrNumberValues<E["data"]>,
  K extends keyof O = keyof O,
  P extends Partial<Pick<O, K>> = Partial<Pick<O, K>>,
> {
  /** The types of events required to reconstruct this projection */
  protected get eventTypes(): ET[] {
      throw new Error("eventTypes must be implemented");
  }
  /** The type of this projection, used to look up the projection in the database */
  protected get projectionType(): string {
      throw new Error("projectionType must be implemented"); 
  }

  protected _events?: Promise<(E | GenericEventInput<E>)[]>;
  protected _stagedEvents: (E | GenericEventInput<E>)[] = [];
  private _savedProjection?: Promise<{ data: V; latestEventId: string } | undefined>;
  private _eventIdentifiers?: Promise<P> | P;

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

  private eventIdentifiers() {
    this._eventIdentifiers ||= this.getEventIdentifiers();
    return this._eventIdentifiers;
  }

  private async getEventsAfterIdentifiers() {
    const data = await this.eventIdentifiers() as unknown as Partial<
      ObjectWithOnlyStringOrNumberValues<E["data"]>
    >;
    const projection = await this.savedProjection;
    return this.eventsClient.getEventStream(this.eventTypes, {
      data,
      after: projection?.latestEventId,
    }) as Promise<(E | GenericEventInput<E>)[]>;
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

  /** Reduce events with a custom reducer function */
  protected async reduceEvents<T>(
    reducer: (acc: T, event: E | GenericEventInput<  E>) => T,
    initialValue: T
  ): Promise<T> {
    return (await this.projectionEvents()).reduce(reducer, initialValue);
  }

  /** Save the projection to the database */
  public async saveProjection() {
    const unsavedEvents = this._stagedEvents.filter(isUnsavedEvent);
    if (unsavedEvents.length > 0) {
      throw new Error("Cannot save projection with unpersisted events");
    }

    const events = await this.projectionEvents();
    if (!events?.length) {
      throw new Error("No events to save");
    }

    const latestEventId = events.at(-1)?.id;
    if (latestEventId === undefined) {
      throw new Error("Latest event ID is undefined");
    }
    return await this.eventsClient.saveProjection({
      type: this.projectionType,
      id: this.id,
      data: await this.asJson(),
      latestEventId,
    });
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

  protected getEventIdentifiers(): Promise<P> | P {
      throw new Error("getEventIdentifiers must be implemented");
  }

  public async asJson(): Promise<V> {
      throw new Error("asJson must be implemented");
  }
}
