import { GenericEventsType } from "./schemaHelpers";

export const isDefined = <T>(val: T | null | undefined): val is T =>
  val !== null && val !== undefined;

export type EventFromType<T, K extends GenericEventsType> = K & {
  type: T;
};

type KeysWithNumericValues<T> = {
  [key in keyof T]: T[key] extends number ? key : never;
}[keyof T];
type KeysWithStringValues<T> = {
  [key in keyof T]: T[key] extends string ? key : never;
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
