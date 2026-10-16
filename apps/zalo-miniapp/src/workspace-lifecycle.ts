/** A UI request generation is not an authorization decision; the API checks every write. */
export class WorkspaceLifecycle {
  private generation = 0;
  private load = 0;
  private edit = 0;
  private active = false;
  private dirty = false;
  private busy = false;
  baseVersion = 0;
  mount() {
    this.active = true;
    this.generation++;
  }
  unmount() {
    this.active = false;
    this.generation++;
  }
  edited() {
    this.edit++;
    this.dirty = true;
  }
  discarded() {
    this.edit++;
    this.dirty = false;
  }
  beginLoad() {
    return { generation: this.generation, load: ++this.load, edit: this.edit };
  }
  accepts(ticket: ReturnType<WorkspaceLifecycle['beginLoad']>) {
    return this.active && ticket.generation === this.generation && ticket.load === this.load;
  }
  mayReplaceDraft(ticket: ReturnType<WorkspaceLifecycle['beginLoad']>, force: boolean) {
    return this.accepts(ticket) && ticket.edit === this.edit && (force || !this.dirty);
  }
  adopt(ticket: ReturnType<WorkspaceLifecycle['beginLoad']>, force: boolean, version: number) {
    if (!this.mayReplaceDraft(ticket, force)) return false;
    this.baseVersion = version;
    this.dirty = false;
    return true;
  }
  startAction() {
    if (!this.active || this.busy) return false;
    this.busy = true;
    return true;
  }
  finishAction() {
    this.busy = false;
  }
}
