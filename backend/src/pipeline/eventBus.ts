import { EventEmitter } from "events";

export interface PipelineProgressEvent {
  campaignId: string;
  stage: "icp" | "discover" | "enrich" | "score" | "completed" | "failed";
  current: number;
  total: number;
  message: string;
  objectiveIndex?: number;
  objective?: string;
}

export interface PipelineLeadEvent {
  campaignId: string;
  lead: any;
}

export interface PipelineDoneEvent {
  campaignId: string;
  stats: any;
}

export interface PipelineErrorEvent {
  campaignId: string;
  message: string;
}

class PipelineEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow up to 100 concurrent SSE listeners per process without warning
    this.setMaxListeners(100);
  }

  emitProgress(event: PipelineProgressEvent): void {
    this.emit(`progress:${event.campaignId}`, event);
    this.emit("progress", event);
  }

  emitLeadAdded(event: PipelineLeadEvent): void {
    this.emit(`lead_added:${event.campaignId}`, event);
    this.emit("lead_added", event);
  }

  emitLeadScored(event: PipelineLeadEvent): void {
    this.emit(`lead_scored:${event.campaignId}`, event);
    this.emit("lead_scored", event);
  }

  emitDone(event: PipelineDoneEvent): void {
    this.emit(`done:${event.campaignId}`, event);
    this.emit("done", event);
  }

  emitError(event: PipelineErrorEvent): void {
    this.emit(`error:${event.campaignId}`, event);
    this.emit("error", event);
  }
}

export const eventBus = new PipelineEventBus();
