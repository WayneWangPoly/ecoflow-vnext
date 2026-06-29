import type { DeliveryEvent, DeliveryStop, PodPhoto } from '@/core/types/database';
import { DELIVERY_STOP_STATUSES } from '@/core/constants/statuses';
import { SEED_NOW } from '@/core/data/seedTime';

export function markArrived(stop: DeliveryStop, userId?: string): { stop: DeliveryStop; event: DeliveryEvent } {
  if (stop.status !== DELIVERY_STOP_STATUSES.pending) throw new Error(`Invalid stop transition from ${stop.status} to ARRIVED`);
  const updatedStop = { ...stop, status: DELIVERY_STOP_STATUSES.arrived, arrivedAt: SEED_NOW, updatedAt: SEED_NOW };
  return { stop: updatedStop, event: makeDeliveryEvent(stop, 'ARRIVED', userId) };
}

export function completeStopWithPod(input: {
  stop: DeliveryStop;
  imageUrl: string;
  takenByUserId: string;
  latitude?: number;
  longitude?: number;
  note?: string;
}): { stop: DeliveryStop; podPhoto: PodPhoto; event: DeliveryEvent } {
  if (input.stop.status !== DELIVERY_STOP_STATUSES.arrived) throw new Error(`Invalid stop transition from ${input.stop.status} to DELIVERED`);
  const stop = { ...input.stop, status: DELIVERY_STOP_STATUSES.delivered, deliveredAt: SEED_NOW, updatedAt: SEED_NOW };
  const podPhoto: PodPhoto = {
    id: `pod-${input.stop.id}`,
    deliveryStopId: input.stop.id,
    orderId: input.stop.orderId,
    imageUrl: input.imageUrl,
    takenByUserId: input.takenByUserId,
    takenAt: SEED_NOW,
    latitude: input.latitude,
    longitude: input.longitude,
    note: input.note,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };
  return { stop, podPhoto, event: makeDeliveryEvent(input.stop, 'POD_UPLOADED', input.takenByUserId) };
}

function makeDeliveryEvent(stop: DeliveryStop, eventType: DeliveryEvent['eventType'], userId?: string): DeliveryEvent {
  return {
    id: `delivery-event-${stop.id}-${eventType}`,
    deliveryRunId: stop.deliveryRunId,
    deliveryStopId: stop.id,
    eventType,
    createdByUserId: userId,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };
}
