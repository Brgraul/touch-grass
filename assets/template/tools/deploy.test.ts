import { describe, expect, it } from 'vitest';
import { DeployError, missingBuildSecrets, parseTarget } from './deploy.ts';

const ref = 'abcdefghijklmnopqrst';

const vars = { SUPABASE_URL: `https://${ref}.supabase.co`, APP_URL: 'https://touch-grass-dev.acme.workers.dev' };

const config = (projectId: string) => `[remotes.dev]\nproject_id = "${projectId}"\n\n[remotes.dev.auth]\nsite_url = "https://touch-grass-dev.acme.workers.dev"\n`;

describe('parseTarget', () => {
  it('takes the project reference from SUPABASE_URL when config.toml agrees', () => {
    expect(parseTarget('dev', vars, config(ref))).toEqual({ environment: 'dev', projectRef: ref });
  });

  it('rejects a [remotes] block for another project', () => {
    expect(() => parseTarget('dev', vars, config('zzzzzzzzzzzzzzzzzzzz'))).toThrow(DeployError);
  });

  it('rejects a config.toml with no block for the environment', () => {
    expect(() => parseTarget('production', vars, config(ref))).toThrow(/no \[remotes\.production\] block/);
  });

  it('does not read a project_id from another environment block', () => {
    expect(() => parseTarget('dev', vars, `[remotes.production]\nproject_id = "${ref}"\n\n[remotes.dev.auth]\nsite_url = "x"\n`)).toThrow(/no \[remotes\.dev\] block/);
  });

  it.each(['http://127.0.0.1:54321', `https://${ref.toUpperCase()}.supabase.co`, 'https://short.supabase.co', `https://${ref}.supabase.co.evil.example`])('rejects the malformed URL %s', url => {
    expect(() => parseTarget('dev', { ...vars, SUPABASE_URL: url }, config(ref))).toThrow(/SUPABASE_URL must look like/);
  });

  it('refuses a placeholder before it reads the URL', () => {
    expect(() => parseTarget('dev', { ...vars, SUPABASE_URL: 'https://dev-project.supabase.co' }, config(ref))).toThrow(/placeholder for SUPABASE_URL/);
  });
});

describe('missingBuildSecrets', () => {
  it('names each unset or empty secret and never a value', () => {
    expect(missingBuildSecrets({ SUPABASE_ACCESS_TOKEN: 'token', SUPABASE_DB_URL: '' })).toEqual(['SUPABASE_DB_URL', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET']);
  });
});
