import type { CheckraImplementation } from './checkra-impl';
import type { SnapshotService } from '../services/snapshot-service';
import { logout } from '../auth/auth';
import { customError } from '../utils/logger';
import type { AuthPendingActionHelper, AuthCallbackInterface } from '../auth/auth-pending-action-helper';
import { AuthenticationRequiredError } from '../auth/auth';

export class CommandDispatcher {
  private checkraImpl: CheckraImplementation;
  private snapshotService: SnapshotService;

  constructor(checkraImpl: CheckraImplementation, snapshotService: SnapshotService) {
    this.checkraImpl = checkraImpl;
    this.snapshotService = snapshotService;
  }

  public async tryHandleCommand(promptText: string): Promise<boolean> {
    const trimmedPrompt = promptText.toLowerCase().trim();

    switch (trimmedPrompt) {
      case '/publish':
        await this.executePublishCommand();
        return true;
      case '/save':
        await this.executeSaveDraftCommand();
        return true;
      case '/logout':
        this.checkraImpl.renderUserMessage("Logging out...");
        logout().then(() => {
          this.checkraImpl.renderUserMessage("You have been logged out. The page should reload automatically.");
        }).catch((err: Error) => {
          customError("[CommandDispatcher] Error during /logout command:", err);
          this.checkraImpl.renderUserMessage(`Logout failed: ${err.message}`);
        });
        return true;
      case '/help':
        this.checkraImpl.showOnboarding();
        return true;
      case '/stats':
        this.checkraImpl.displayStatsBadges();
        return true;
      default:
        return false;
    }
  }

  private async executePublishCommand(): Promise<void> {
    if (this.checkraImpl.appliedFixStore.getSize() === 0) {
      this.checkraImpl.renderUserMessage("No changes have been applied to publish.");
      return;
    }
    this.checkraImpl.renderUserMessage("Publishing changes...");
    try {
      const result = await this.snapshotService.publishSnapshot(this.checkraImpl.appliedFixStore.getAll());
      this.checkraImpl.renderUserMessage(result.message);
      if (result.success && result.cdnUrl) {
        this.checkraImpl.renderUserMessage('Share URL: <a href="' + result.cdnUrl + '" target="_blank" rel="noopener noreferrer">' + result.cdnUrl + '</a>');
      } else if (!result.success && result.snapshotId) {
        this.checkraImpl.renderUserMessage('Snapshot ID (stored but not fully published): ' + result.snapshotId.substring(0,8) + '...');
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        await (this.checkraImpl as any).invokeAuthRedirect('publish', Array.from(this.checkraImpl.appliedFixStore.getAll().entries()), error);
        this.checkraImpl.renderUserMessage("Authentication required to publish. Please log in to continue.");
      } else {
        customError("[CommandDispatcher] Error during /publish command:", error);
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.checkraImpl.showError('Failed to publish: ' + displayErrorMessage);
      }
    }
  }

  private async executeSaveDraftCommand(): Promise<void> {
    if (this.checkraImpl.appliedFixStore.getSize() === 0) {
      this.checkraImpl.renderUserMessage("No changes have been applied to save as a draft.");
      return;
    }
    this.checkraImpl.renderUserMessage("Saving draft...");
    try {
      const result = await this.snapshotService.saveSnapshotAsDraft(this.checkraImpl.appliedFixStore.getAll());
      this.checkraImpl.renderUserMessage(result.message);
      if (result.success && result.accessUrl) {
        this.checkraImpl.renderUserMessage('Access your draft (owner only): <a href="' + result.accessUrl + '" target="_blank" rel="noopener noreferrer">' + result.accessUrl + '</a>');
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        await (this.checkraImpl as any).invokeAuthRedirect('saveDraft', Array.from(this.checkraImpl.appliedFixStore.getAll().entries()), error);
        this.checkraImpl.renderUserMessage("Authentication required to save draft. Please log in and try again.");
      } else {
        customError("[CommandDispatcher] Error during /save command:", error);
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.checkraImpl.showError('Failed to save draft: ' + displayErrorMessage);
      }
    }
  }
} 