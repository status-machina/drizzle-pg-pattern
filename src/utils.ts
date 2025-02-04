import { GenericEventsType } from "./schemaHelpers";

export const isDefined = <T>(val: T | null | undefined): val is T =>
  val !== null && val !== undefined;

export type EventFromType<T, K extends GenericEventsType> = K & {
  type: T;
};

export type ExtractDataFromEvents<Events, Types> = Events extends { type: Types; data: infer Data }
  ? ObjectWithOnlyStringOrNumberValues<Data>
  : never;

export type UnionToIntersection<U> = 
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export type DataForEventTypes<Events, Types> = UnionToIntersection<ExtractDataFromEvents<Events, Types>>;

type ExtractEventData<Event, Type> = Event extends { type: Type; data: infer Data }
  ? Data
  : never;

type IntersectEventData<Events, Types> = UnionToIntersection<ExtractEventData<Events, Types>>;





export type StreamOptionsForEvents<
  Events extends { type: Type },
  Type extends string | number | symbol
> = {
  eventTypes: Type[];
  options?: {
    data?: Partial<ObjectWithOnlyStringOrNumberValuesOrArrayValues<IntersectEventData<Events, Type>>>;
    after?: string;
  };
};

type KeysWithNumericValues<T> = {
  [key in keyof T]: T[key] extends number | undefined ? key : never;
}[keyof T];
type KeysWithStringValues<T> = {
  [key in keyof T]: T[key] extends string | undefined ? key : never;
}[keyof T];
type ObjectWithOnlyNumericValues<T> = {
  [key in KeysWithNumericValues<T>]: number;
};
type ObjectWithOnlyStringValues<T> = {
  [key in KeysWithStringValues<T>]: string;
};
type ObjectWithOnlyNumericArrayValues<T> = {
  [key in KeysWithNumericValues<T>]: number[];
};
type ObjectWithOnlyStringArrayValues<T> = {
  [key in KeysWithStringValues<T>]: string[];
};

export type ObjectWithOnlyStringOrNumberValues<T> =
  ObjectWithOnlyNumericValues<T> & ObjectWithOnlyStringValues<T>;
export type ObjectWithOnlyStringOrNumberArrayValues<T> =
  ObjectWithOnlyNumericArrayValues<T> & ObjectWithOnlyStringArrayValues<T>;
export type ObjectWithOnlyStringOrNumberValuesOrArrayValues<T> =
  ObjectWithOnlyStringOrNumberValues<T> |
    ObjectWithOnlyStringOrNumberArrayValues<T>;
