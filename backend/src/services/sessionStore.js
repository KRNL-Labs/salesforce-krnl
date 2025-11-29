const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const tableName = process.env.KRNL_SESSION_TABLE || 'krnl_sessions';

let supabase = null;

if (!supabaseUrl || !supabaseKey) {
  logger.warn('Supabase configuration missing (SUPABASE_URL / SUPABASE_SERVICE_KEY), session persistence is disabled');
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

/**
 * Persist a KRNL session to Supabase Postgres. This is a best-effort helper; it
 * never throws back to callers, it only logs errors.
 *
 * @param {object} session - Session object from KRNLService.sessions
 */
async function saveSession(session) {
  if (!supabase || !session || !session.sessionId) {
    return;
  }

  try {
    // Avoid storing sensitive access tokens in Postgres; callers will rely on
    // environment-based Salesforce credentials when possible.
    const { salesforceAccessToken, ...safeSession } = session;

    const row = {
      id: safeSession.sessionId,
      status: safeSession.status || 'UNKNOWN',
      session: safeSession
    };

    const { error } = await supabase
      .from(tableName)
      .upsert(row, { onConflict: 'id' });

    if (error) {
      logger.error('Failed to persist KRNL session to Supabase', {
        sessionId: safeSession.sessionId,
        error: error.message
      });
    }
  } catch (e) {
    logger.error('Unexpected error while saving KRNL session to Supabase', {
      sessionId: session.sessionId,
      error: e.message
    });
  }
}

/**
 * Load a persisted KRNL session from Supabase Postgres.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>} - The session object, or null if not found / error
 */
async function loadSession(sessionId) {
  if (!supabase || !sessionId) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('session')
      .eq('id', sessionId)
      .single();

    if (error) {
      // PGRST116 is Supabase's "row not found" code; treat it as a miss, not an error.
      if (error.code !== 'PGRST116') {
        logger.error('Failed to load KRNL session from Supabase', {
          sessionId,
          error: error.message
        });
      }
      return null;
    }

    if (!data || !data.session) {
      return null;
    }

    return data.session;
  } catch (e) {
    logger.error('Unexpected error while loading KRNL session from Supabase', {
      sessionId,
      error: e.message
    });
    return null;
  }
}

module.exports = {
  saveSession,
  loadSession
};
