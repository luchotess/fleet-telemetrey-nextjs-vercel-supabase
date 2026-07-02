import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import type { DomainEvent } from "@/lib/domain/types";

type EventLogClient = PrismaClient | Prisma.TransactionClient;

export function buildEvent(
  eventType: string,
  aggregateId: string | null,
  payload: Record<string, unknown> = {},
): DomainEvent {
  return {
    eventType,
    aggregateId,
    payload,
    occurredAt: new Date(),
  };
}

export async function writeDomainEventLogs(
  events: DomainEvent[],
  client: EventLogClient = getPrisma(),
) {
  if (events.length === 0) {
    return;
  }

  await client.domainEventLog.createMany({
    data: events.map((event) => ({
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      payload: {
        ...event.payload,
        occurred_at: event.occurredAt.toISOString(),
      },
    })),
  });
}
