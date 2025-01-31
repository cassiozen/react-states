import { TEvent, TContext, TTransitions, Err, Ok } from '../';

export type DevtoolMessage =
  | {
      type: 'dispatch';
      event: TEvent;
      ignored: boolean;
    }
  | {
      type: 'state';
      context: {
        state: string;
      };
      transitions: TTransitions;
    }
  | {
      type: 'transitions';
      transitions: TTransitions;
    }
  | {
      type: 'exec';
      context: {
        state: string;
      };
      name: string;
    }
  | {
      type: 'exec-resolved';
      context: {
        state: string;
      };
      name: string;
      result: Ok<any> | Err<any>;
    };

export type HistoryItem =
  | {
      type: 'state';
      context: TContext;
      exec:
        | {
            state: 'IDLE';
          }
        | {
            state: 'PENDING';
            name: string;
          }
        | {
            state: 'RESOLVED';
            result: any;
            name: string;
          }
        | {
            state: 'CANCELLED';
            name: string;
          };
    }
  | {
      type: 'event';
      event: TEvent;
      ignored: boolean;
    };

export type StatesData = {
  [id: string]: {
    isMounted: boolean;
    history: HistoryItem[];
    transitions: TTransitions;
    triggerTransitions: () => void;
  };
};

export type Subscription = (statesData: StatesData) => () => void;

export class Manager {
  private subscriptions: Function[] = [];
  states: StatesData = {};
  private notify() {
    this.subscriptions.forEach(cb => cb(this.states));
  }
  onMessage(id: string, message: DevtoolMessage) {
    switch (message.type) {
      case 'state': {
        const firstHistoryItem = this.states[id].history[0];
        // This happens on mount, where we immediately add the current context,
        // but also the updating useEffect will also add the same context
        if (firstHistoryItem.type === 'state' && firstHistoryItem.context === message.context) {
          return;
        }

        this.states = {
          ...this.states,
          [id]: {
            ...this.states[id],
            history: [
              {
                type: 'state',
                context: message.context,
                exec: {
                  state: 'IDLE',
                },
              },
              ...this.states[id].history,
            ],
          },
        };
        break;
      }
      case 'transitions': {
        this.states = {
          ...this.states,
          [id]: {
            ...this.states[id],
            transitions: message.transitions,
          },
        };
        break;
      }
      case 'dispatch': {
        this.states = {
          ...this.states,
          [id]: {
            ...this.states[id],
            history: [
              {
                type: 'event',
                event: message.event,
                ignored: message.ignored,
              },
              ...this.states[id].history,
            ],
          },
        };
        break;
      }
      case 'exec': {
        const lastStateEntryIndex = this.states[id].history.findIndex(item => item.type === 'state')!;
        const lastStateEntry = this.states[id].history[lastStateEntryIndex] as HistoryItem & { type: 'state' };
        this.states = {
          ...this.states,
          [id]: {
            ...this.states[id],
            history: [
              ...this.states[id].history.slice(0, lastStateEntryIndex),
              {
                ...lastStateEntry,
                exec: {
                  state: 'PENDING',
                  name: message.name,
                },
              },
              ...this.states[id].history.slice(lastStateEntryIndex + 1),
            ],
          },
        };
        break;
      }
      case 'exec-resolved': {
        const lastStateEntryIndex = this.states[id].history.findIndex(
          item => item.type === 'state' && item.context.state === message.context.state,
        )!;
        const lastStateEntry = this.states[id].history[lastStateEntryIndex] as HistoryItem & { type: 'state' };
        this.states = {
          ...this.states,
          [id]: {
            ...this.states[id],
            history: [
              ...this.states[id].history.slice(0, lastStateEntryIndex),
              {
                ...lastStateEntry,
                exec:
                  !message.result.ok && message.result.error.type === 'CANCELLED'
                    ? {
                        state: 'CANCELLED',
                        name: message.name,
                      }
                    : {
                        state: 'RESOLVED',
                        name: message.name,
                        result: message.result,
                      },
              },
              ...this.states[id].history.slice(lastStateEntryIndex + 1),
            ],
          },
        };
        break;
      }
    }
    this.notify();
  }
  mount(id: string, context: TContext, triggerTransitions: () => void) {
    this.states = {
      ...this.states,
      [id]: {
        isMounted: true,
        history: [
          {
            type: 'state',
            context,
            exec: {
              state: 'IDLE',
            },
          },
        ],
        // @ts-ignore
        transitions: context[DEBUG_TRANSITIONS],
        triggerTransitions,
      },
    };
    this.notify();
  }
  dispose(id: string) {
    this.states = {
      ...this.states,
      [id]: {
        ...this.states[id],
        isMounted: false,
      },
    };
    this.notify();
  }
  subscribe(cb: Function) {
    this.subscriptions.push(cb);
    return () => {
      this.subscriptions.splice(this.subscriptions.indexOf(cb), 1);
    };
  }
}
