import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAudioMonitoring1700000000022 implements MigrationInterface {
  name = 'CreateAudioMonitoring1700000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Org-level (and optionally jurisdiction-level) policy controlling
      -- whether audio can be recorded at all. Rows here are the gate every
      -- session creation checks BEFORE anything is recorded - see the
      -- app-layer AudioPolicyEngine for why "disabled" is the default and
      -- cannot be bypassed by a session-level flag.
      CREATE TABLE audio_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        country VARCHAR(2), -- NULL = organization-wide default across all countries it operates in
        status VARCHAR(30) NOT NULL DEFAULT 'disabled',
        -- disabled|enabled_with_consent|enabled_for_sos_only|enabled_for_security_incidents|covert_requires_approval|prohibited_by_jurisdiction
        retention_days INTEGER DEFAULT 90,
        requires_passenger_notice BOOLEAN DEFAULT true,
        set_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, country)
      );

      CREATE TABLE audio_consents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        driver_id UUID REFERENCES drivers(id),
        vehicle_id UUID REFERENCES vehicles(id),
        consent_type VARCHAR(20) NOT NULL DEFAULT 'driver', -- 'driver'|'passenger_notice_acknowledged'
        legal_basis VARCHAR(50), -- 'explicit_consent'|'employment_contract'|'legitimate_interest'|'legal_obligation'
        granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        withdrawn_at TIMESTAMP,
        withdrawal_reason TEXT,
        consent_document_url TEXT, -- link to signed consent form, if applicable
        recorded_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audio_consents_driver ON audio_consents (driver_id) WHERE withdrawn_at IS NULL;

      CREATE TABLE audio_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id),
        vehicle_id UUID REFERENCES vehicles(id),
        driver_id UUID REFERENCES drivers(id),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        session_type VARCHAR(30) NOT NULL, -- live_monitoring|scheduled_recording|voice_activated|sos_triggered|incident_triggered|manual_request
        trigger_type VARCHAR(30),
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        duration_seconds INTEGER,
        audio_format VARCHAR(10) DEFAULT 'opus',
        file_size_bytes BIGINT,
        storage_location TEXT,
        encryption_key_id VARCHAR(100),
        transcription_enabled BOOLEAN DEFAULT false,
        transcript_status VARCHAR(20), -- 'pending'|'processing'|'completed'|'failed'|NULL if not requested
        consent_id UUID REFERENCES audio_consents(id),
        legal_basis VARCHAR(50),
        status VARCHAR(20) DEFAULT 'requested', -- requested|policy_denied|consent_missing|recording|completed|failed|deleted
        denial_reason TEXT,
        created_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id), -- required for covert sessions, per audio_policies.status = 'covert_requires_approval'
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audio_sessions_org_time ON audio_sessions (organization_id, created_at DESC);
      CREATE INDEX idx_audio_sessions_vehicle ON audio_sessions (vehicle_id, created_at DESC);
      CREATE INDEX idx_audio_sessions_status ON audio_sessions (status);

      CREATE TABLE audio_clips (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES audio_sessions(id) ON DELETE CASCADE,
        clip_index INTEGER DEFAULT 0, -- sessions may be chunked into multiple clips
        storage_location TEXT NOT NULL,
        file_size_bytes BIGINT,
        duration_seconds DECIMAL(8,2),
        sha256_hash VARCHAR(64) NOT NULL, -- evidence integrity - see audio_evidence_exports for the chain-of-custody use
        recorded_at TIMESTAMP NOT NULL,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audio_clips_session ON audio_clips (session_id, clip_index);

      CREATE TABLE audio_transcripts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clip_id UUID REFERENCES audio_clips(id) ON DELETE CASCADE,
        language VARCHAR(10),
        transcript_text TEXT,
        confidence DECIMAL(4,3),
        detected_keywords TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Every read/export/playback of any audio clip - "no public access,
      -- access restricted by role" is enforced in the application layer;
      -- this table is what makes that enforcement auditable after the fact.
      CREATE TABLE audio_access_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clip_id UUID REFERENCES audio_clips(id) ON DELETE CASCADE,
        session_id UUID REFERENCES audio_sessions(id),
        accessed_by UUID REFERENCES users(id),
        access_type VARCHAR(20) NOT NULL, -- 'playback'|'download'|'export'|'transcript_view'
        ip_address INET,
        justification TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audio_access_logs_clip ON audio_access_logs (clip_id, created_at DESC);

      -- Formal evidence export with a hash chain - each export links back to
      -- the clip's original hash (audio_clips.sha256_hash) and re-hashes the
      -- export bundle itself, so any tampering after export is detectable.
      CREATE TABLE audio_evidence_exports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES audio_sessions(id) ON DELETE CASCADE,
        exported_by UUID REFERENCES users(id),
        case_reference VARCHAR(100), -- e.g. police report number, internal case ID
        export_hash VARCHAR(64) NOT NULL, -- SHA-256 of the full export bundle (all clips + metadata)
        chain_of_custody JSONB NOT NULL, -- ordered list of {clipId, originalHash, verifiedAt}
        digital_signature TEXT, -- reserved for a future signing-key integration
        exported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audio_evidence_exports_session ON audio_evidence_exports (session_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audio_evidence_exports`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_access_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_transcripts`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_clips`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_consents`);
    await queryRunner.query(`DROP TABLE IF EXISTS audio_policies`);
  }
}
