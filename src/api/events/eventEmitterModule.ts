import { EventEmitter } from "events";

let eventEmitterInstance: EventEmitter;

export function getEventEmitter(): EventEmitter {
  if (!eventEmitterInstance) {
    eventEmitterInstance = new EventEmitter();
  }
  return eventEmitterInstance;
}