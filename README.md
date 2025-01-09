# Status Machina Drizzle Pattern

A pattern for implementing event sourcing with PostgreSQL and Drizzle ORM.

## Setup

### 1. Create Event and Projection Tables

```typescript
// schema.ts
import { createEventsTable, createProjectionsTable } from 'status-machina-drizzle-pattern';

export const events = createEventsTable({
  schema: "my_app",
  name: "events",
  dataIndexes: ["cartId", "productId"], // Add indexes for fields you'll query frequently
});

export const projections = createProjectionsTable({
  schema: "my_app",
  name: "views",
  dataIndexes: ["cartId"],
});
```

### 2. Define Event Types

```typescript
// eventTypes.ts
export enum AppEventTypes {
  CART_CREATED = "CART_CREATED",
  ITEM_ADDED_TO_CART = "ITEM_ADDED_TO_CART",
  ITEM_REMOVED_FROM_CART = "ITEM_REMOVED_FROM_CART",
  CART_CHECKED_OUT = "CART_CHECKED_OUT",
}
```

### 3. Create Event Base Type

```typescript
// eventBase.ts
export type AppEventBase = {
  type: AppEventTypes;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  id: string;
};
```

### 4. Define Event Types and Union

```typescript
// events/index.ts
import { InputOf } from 'status-machina-drizzle-pattern';

interface CartCreatedEvent extends AppEventBase {
  type: AppEventTypes.CART_CREATED;
  data: {
    cartId: string;
    userId: string;
  };
}

interface ItemAddedToCartEvent extends AppEventBase {
  type: AppEventTypes.ITEM_ADDED_TO_CART;
  data: {
    cartId: string;
    productId: string;
    quantity: number;
    priceAtTime: number;
  };
}

interface ItemRemovedFromCartEvent extends AppEventBase {
  type: AppEventTypes.ITEM_REMOVED_FROM_CART;
  data: {
    cartId: string;
    productId: string;
    quantity: number;
  };
}

interface CartCheckedOutEvent extends AppEventBase {
  type: AppEventTypes.CART_CHECKED_OUT;
  data: {
    cartId: string;
    checkoutTime: string;
  };
}

export type AppEvent = 
  | CartCreatedEvent 
  | ItemAddedToCartEvent 
  | ItemRemovedFromCartEvent
  | CartCheckedOutEvent;

export type AppEventInput = InputOf<AppEvent>;
```

### 5. Create Event Client

```typescript
// client.ts
import { createEventClient } from 'status-machina-drizzle-pattern';
import { db } from './db';
import { events, projections } from './schema';
import { AppEventTypes } from './eventTypes';
import { AppEvent } from './events';

export const getEventClient = () => {
  return createEventClient<
    AppEventTypes,
    AppEvent,
    Record<string, unknown>,
    any,
    typeof db
  >(db, events, projections);
};
```

## Usage

### Writing Events

```typescript
const client = getEventClient();

// Save a single event
await client.saveEvent({
  type: AppEventTypes.CART_CREATED,
  data: {
    cartId: "cart_123",
    userId: "user_456"
  }
});

// Save multiple events
await client.saveEvents([
  {
    type: AppEventTypes.ITEM_ADDED_TO_CART,
    data: {
      cartId: "cart_123",
      productId: "prod_789",
      quantity: 2,
      priceAtTime: 1999
    }
  },
  {
    type: AppEventTypes.ITEM_REMOVED_FROM_CART,
    data: {
      cartId: "cart_123",
      productId: "prod_789",
      quantity: 1
    }
  }
]);
```

### Creating Projections

```typescript
// projections/base.ts
import { ProjectionBase } from 'status-machina-drizzle-pattern';

export const Projection = <T extends Record<string, unknown>>() => ProjectionBase<
  AppEventTypes,
  AppEvent,
  EventClient,
  T
>;

// reducers/to.items.ts
import { AppEvent, AppEventTypes } from '../events';
import { CartItem } from '../types';

export const toItems = (
  items: CartItem[],
  event: AppEvent
): CartItem[] => {
  switch (event.type) {
    case AppEventTypes.ITEM_ADDED_TO_CART: {
      const existingItem = items.find(i => i.productId === event.data.productId);
      return existingItem
        ? items.map(i => i.productId === event.data.productId
            ? { ...i, quantity: i.quantity + event.data.quantity }
            : i)
        : [...items, {
            productId: event.data.productId,
            quantity: event.data.quantity,
            priceAtTime: event.data.priceAtTime
          }];
    }
    case AppEventTypes.ITEM_REMOVED_FROM_CART: {
      return items
        .map(i => i.productId === event.data.productId
          ? { ...i, quantity: i.quantity - event.data.quantity }
          : i)
        .filter(i => i.quantity > 0);
    }
    default:
      return items;
  }
};

// reducers/to.userId.ts
export const toUserId = (
  userId: string,
  event: AppEvent
): string => {
  switch (event.type) {
    case AppEventTypes.CART_CREATED:
      return event.data.userId;
    default:
      return userId;
  }
};

// reducers/to.isCheckedOut.ts
export const toIsCheckedOut = (
  isCheckedOut: boolean,
  event: AppEvent
): boolean => {
  switch (event.type) {
    case AppEventTypes.CART_CHECKED_OUT:
      return true;
    default:
      return isCheckedOut;
  }
};

// projections/cart.projection.ts
import { Projection } from './base';
import { toItems } from '../reducers/to.items';
import { toUserId } from '../reducers/to.userId';
import { toIsCheckedOut } from '../reducers/to.isCheckedOut';

type CartItem = {
  productId: string;
  quantity: number;
  priceAtTime: number;
};

type CartView = {
  id: string;
  userId: string;
  items: CartItem[];
  isCheckedOut: boolean;
  total: number;
};

export class CartProjection extends Projection<CartView>() {
  protected get eventTypes() {
    return [
      AppEventTypes.CART_CREATED,
      AppEventTypes.ITEM_ADDED_TO_CART,
      AppEventTypes.ITEM_REMOVED_FROM_CART,
      AppEventTypes.CART_CHECKED_OUT
    ];
  }

  protected get projectionType() {
    return "SHOPPING_CART";
  }

  constructor(
    private cartId: string,
    protected eventsClient: ReturnType<typeof getEventClient>
  ) {
    super(eventsClient);
  }

  public get id() {
    return this.cartId;
  }

  protected getEventIdentifiers() {
    return { cartId: this.cartId };
  }

  public async asJson(): Promise<CartView> {
    const userId = await this.reduceEvents(toUserId, "");
    const items = await this.reduceEvents(toItems, []);
    const isCheckedOut = await this.reduceEvents(toIsCheckedOut, false);
    
    const total = items.reduce((sum, item) => 
      sum + (item.quantity * item.priceAtTime), 0);

    return {
      id: this.cartId,
      userId,
      items,
      isCheckedOut,
      total
    };
  }
}
```

## Features

- Event sourcing with PostgreSQL
- Strongly typed events and projections
- Optimistic concurrency control
- Projection caching
- Event stream validation

## License

MIT 