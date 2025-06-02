import { fetchProtected, AuthenticationRequiredError } from '../auth/auth';
import { CDN_DOMAIN } from '../config';
import { customError } from '../utils/logger';

export interface StatsFetcherResult {
  success: boolean;
  message?: string; // For errors or informational messages like "No data"
  markdownTable?: string; // Formatted data
  queryName: string; // To be passed back for context if needed
}

// Helper function to get a user-friendly display name for a query
export function getFriendlyQueryName(queryName: string): string {
  switch (queryName) {
    case 'metrics_1d':
      return 'Stats (last 24h)';
    case 'metrics_7d':
      return 'Stats (last 7d)';
    case 'geo_top5_7d':
      return 'Top Countries (last 7d)';
    default:
      return queryName.replace(/_/g, ' '); // Default fallback
  }
}

export class StatsFetcher {
  constructor() {}

  public async fetchStats(queryName: string): Promise<StatsFetcherResult> {
    try {
      const response = await fetchProtected(`https://${CDN_DOMAIN}/analytics/${queryName}`);

      if (!response.ok) {
        const errorText = await response.text();
        // Throw an error that can be caught by the caller to decide on user message
        throw new Error(`Failed to fetch stats: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      if (!data.rows || data.rows.length === 0) {
        return {
          success: false,
          message: "No data available for this query.",
          queryName
        };
      }

      let markdownTable = "";
      if (queryName === 'metrics_1d' || queryName === 'metrics_7d') {
        markdownTable = `| Variant | Views   | Uniques | Avg. Dwell (ms) |\\n|---------|---------|---------|-----------------|\\n`;
        data.rows.forEach((row: any) => {
          markdownTable += `| ${row.var || 'N/A'} | ${row.views || '0'} | ${row.uniques || '0'} | ${row.avg_dur_ms || '0'} |\\n`;
        });
      } else if (queryName === 'geo_top5_7d') {
        markdownTable = `| Variant | Country | Views   | Uniques | Avg. Dwell (ms) |\\n|---------|---------|---------|---------|-----------------|\\n`;
        data.rows.forEach((row: any) => {
          markdownTable += `| ${row.var || 'N/A'} | ${row.country || 'N/A'} | ${row.views || '0'} | ${row.uniques || '0'} | ${row.avg_dur_ms || '0'} |\\n`;
        });
      }

      if (markdownTable) {
        return {
          success: true,
          markdownTable,
          queryName
        };
      } else {
        return {
          success: false,
          message: "Could not format data for display.",
          queryName
        };
      }
    } catch (error) {
      // Re-throw AuthenticationRequiredError to be handled by the caller
      if (error instanceof AuthenticationRequiredError) {
        throw error;
      }
      // For other errors, log them and return a result indicating failure
      customError(`[StatsFetcher] Error fetching stats for ${queryName}:`, error);
      const displayMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Sorry, I couldn't fetch those stats. Error: ${displayMessage}`,
        queryName
      };
    }
  }
} 