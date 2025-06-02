import { fetchProtected, AuthenticationRequiredError } from '../auth/auth';
import { API_BASE } from '../config';
import { getSiteId } from '../utils/id';
import type { AppliedFixInfo } from '../ui/applied-fix-store';
import { customError, customWarn } from '../utils/logger';

interface SnapshotChange {
  targetSelector: string;
  appliedHtml: string;
  sessionFixId: string;
}

interface SnapshotPayload {
  snapshotId: string;
  timestamp: string;
  pageUrl: string;
  changes: SnapshotChange[];
  publish: boolean;
}

export interface SnapshotOperationResult {
  success: boolean;
  message: string;
  snapshotId?: string;
  accessUrl?: string; // For drafts
  cdnUrl?: string;    // For published snapshots
}

export class SnapshotService {
  constructor() {}

  private async storeSnapshot(appliedFixesMap: Map<string, AppliedFixInfo>, publish: boolean): Promise<SnapshotOperationResult> {
    if (appliedFixesMap.size === 0) {
      return { success: false, message: "No changes have been applied." };
    }

    const changesToStore = Array.from(appliedFixesMap.values()).map(fixInfo => ({
      targetSelector: fixInfo.stableTargetSelector,
      appliedHtml: fixInfo.fixedOuterHTML,
      sessionFixId: fixInfo.originalElementId
    }));

    const siteId = getSiteId();
    const clientGeneratedSnapshotId = crypto.randomUUID();

    const snapshotPayload: SnapshotPayload = {
      snapshotId: clientGeneratedSnapshotId,
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      changes: changesToStore,
      publish: publish
    };

    const postSnapshotUrl = `${API_BASE}/sites/${siteId}/snapshots`;

    try {
      const postResponse = await fetchProtected(postSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotPayload),
      });

      if (!postResponse.ok) {
        const errorBody = await postResponse.text();
        let specificErrorMessage = `Storing snapshot (publish: ${publish}) failed: ${postResponse.status} ${postResponse.statusText}`;
        try {
            const errorJson = JSON.parse(errorBody);
            if (errorJson && errorJson.message) {
                specificErrorMessage += ` - ${errorJson.message}`;
            }
        } catch (parseErr) {
            specificErrorMessage += ` - ${errorBody}`;
        }
        throw new Error(specificErrorMessage);
      }

      const postResult = await postResponse.json();
      // Expected: { message, snapshotId, accessUrl (if !publish), s3SnapshotPath }

      if (postResult.snapshotId !== clientGeneratedSnapshotId) {
        const message = "Error: Snapshot ID mismatch after initial save.";
        customError('[SnapshotService]', message, { client: clientGeneratedSnapshotId, server: postResult.snapshotId });
        return { success: false, message, snapshotId: clientGeneratedSnapshotId };
      }
      
      return {
        success: true,
        message: postResult.message || (publish ? "Snapshot stored for publishing." : "Draft stored successfully."),
        snapshotId: clientGeneratedSnapshotId,
        accessUrl: publish ? undefined : postResult.accessUrl,
      };

    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        // Let checkra-impl handle redirection by re-throwing
        throw error;
      }
      customError('[SnapshotService] Error storing snapshot:', error);
      const displayMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to store snapshot: ${displayMessage}` };
    }
  }

  private async promoteSnapshot(snapshotId: string): Promise<SnapshotOperationResult> {
    const siteId = getSiteId();
    const promoteUrl = `${API_BASE}/sites/${siteId}/variants/${snapshotId}`;

    try {
      const promoteResponse = await fetchProtected(promoteUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Empty body for promotion
      });

      if (!promoteResponse.ok) {
        const promoteErrorBody = await promoteResponse.text();
        let specificPromoteErrorMessage = `Promotion failed: ${promoteResponse.status} ${promoteResponse.statusText}`;
        try {
            const errorJson = JSON.parse(promoteErrorBody);
            if (errorJson && errorJson.message) {
                specificPromoteErrorMessage += ` - ${errorJson.message}`;
            }
        } catch (parseErr) {
            specificPromoteErrorMessage += ` - ${promoteErrorBody}`;
        }
        throw new Error(specificPromoteErrorMessage);
      }

      const promoteResult = await promoteResponse.json();
      // Expected: { message, siteId, snapshotId (promoted), promotedAt, cdnUrl }
      if (promoteResult.cdnUrl && promoteResult.snapshotId) {
        return {
          success: true,
          message: promoteResult.message || "Published successfully!",
          snapshotId: promoteResult.snapshotId,
          cdnUrl: promoteResult.cdnUrl
        };
      } else {
        customWarn('[SnapshotService] Promotion successful, but cdnUrl or snapshotId missing:', promoteResult);
        return { success: false, message: "Snapshot promoted, but could not get the public share URL.", snapshotId };
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        throw error; // Re-throw for checkra-impl to handle
      }
      customError('[SnapshotService] Error promoting snapshot:', error);
      const displayMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Error promoting snapshot ${snapshotId.substring(0,8)}...: ${displayMessage}`, snapshotId };
    }
  }

  public async publishSnapshot(appliedFixesMap: Map<string, AppliedFixInfo>): Promise<SnapshotOperationResult> {
    const storeResult = await this.storeSnapshot(appliedFixesMap, true);

    if (!storeResult.success || !storeResult.snapshotId) {
      // If storing failed (e.g., no changes, initial storage error not auth-related)
      // or if it succeeded but somehow didn't return a snapshotId (which shouldn't happen on success)
      return storeResult; // Return the error message from storeSnapshot
    }

    // If storing was successful and we have a snapshotId, proceed to promote
    customWarn(`[SnapshotService] Snapshot ${storeResult.snapshotId} stored. Attempting to promote.`);
    const promoteResult = await this.promoteSnapshot(storeResult.snapshotId);
    
    // Combine messages or decide on final message
    if (promoteResult.success) {
        return {
            ...promoteResult, // Contains success, cdnUrl, final snapshotId
            message: `${storeResult.message} ${promoteResult.message}` // Combine messages
        };
    }

    // Promotion failed
    return {
        success: false,
        message: `Snapshot stored (ID: ${storeResult.snapshotId.substring(0,8)}...), but promotion failed: ${promoteResult.message}`,
        snapshotId: storeResult.snapshotId // Still return the stored snapshotId
    };
  }

  public async saveSnapshotAsDraft(appliedFixesMap: Map<string, AppliedFixInfo>): Promise<SnapshotOperationResult> {
    return this.storeSnapshot(appliedFixesMap, false);
  }
} 