/** Chen ER selections: entity, attribute, relationship (+ participants) and the participant line. */
import { useState } from 'react';
import * as ops from '@/model/ops';
import { analyzeRelationship, identifiedParticipants, relationshipCandidateKeys } from '@/model/erSemantics';
import { weakEntityOwners } from '@/model/erSemantics';
import { attributesOf, ownAttributes, participationsOfEntity, rootOwner } from '@/model/queries';
import type { ErAttribute, ErEntity, ErModel, ErParticipant, ErRelationship, Id } from '@/model/types';
import { editorStore } from '@/store';
import { useT } from '@/i18n';
import { Button, Checkbox, IconButton, Select, Switch } from '../../components';
import { AddAttributeMenu, AttributeList } from './AttributeList';
import { moveAttributeTo, ownerChoices, ownerValue } from './attrMove';
import { GlyphHeader } from './Header';
import { issuesOf, runEdit, useIssueMap } from './edit';
import { currentIdentified, defaultParticipantEntity, effectLines, identifiedChoices, needsKeyPicker, participantLabel, toggleKeyParticipant } from './forms';
import { selectRef } from './nav';
import { CommitInput, CommitTextarea, IssueBadges, IssueDot, Note, Section } from './parts';

// ----- entity --------------------------------------------------------------------------------------------------------------

export function EntityPanel({ model, entity }: { model: ErModel; entity: ErEntity }) {
  const t = useT();
  const issueMap = useIssueMap();
  const assoc = entity.associativeOf ? model.relationships[entity.associativeOf] : undefined;
  const owners = entity.weak ? weakEntityOwners(model, entity.id) : [];
  const participations = participationsOfEntity(model, entity.id).filter((p) => p.relationship.id !== entity.associativeOf);
  const patch = (label: string, p: Parameters<typeof ops.updateEntity>[3]): boolean => runEdit(label, (d) => ops.updateEntity(d, model.id, entity.id, p));
  return (
    <>
      <GlyphHeader spec={{ kind: 'entity', weak: entity.weak }} title={entity.name} kind={entity.weak ? t('properties.kind.weakEntity') : assoc ? t('properties.kind.associative') : t('properties.kind.entity')} />
      <IssueBadges issues={issuesOf(issueMap, { kind: 'entity', id: entity.id })} />
      <Section title={t('properties.section.general')}>
        <CommitInput label={t('properties.name')} required value={entity.name} onCommit={(name) => patch(t('properties.rename'), { name })} />
        <Switch
          label={t('properties.entity.weak')}
          checked={entity.weak}
          disabled={!!assoc}
          description={assoc ? t('properties.entity.weakAssociative') : t('properties.entity.weakDesc')}
          onChange={(weak) => patch(t('properties.entity.toggleWeak'), { weak })}
        />
        {entity.weak && owners.length === 0 ? <Note tone="warning">{t('properties.entity.noOwner')}</Note> : null}
        {owners.map((o) => (
          <Note key={`${o.relationship.id}:${o.owner.id}`} tone="info">
            {t('properties.entity.ownedBy', { owner: o.owner.name, relationship: o.relationship.name })}
          </Note>
        ))}
        <CommitTextarea label={t('properties.description')} value={entity.description ?? ''} onCommit={(v) => patch(t('properties.describe'), { description: v.trim() === '' ? undefined : v })} />
      </Section>
      {assoc ? (
        <Section title={t('properties.entity.associativeTitle')} testId="associative-section">
          <Note>{t('properties.entity.associativeDesc', { relationship: assoc.name })}</Note>
          <div>
            <Button size="sm" onClick={() => runEdit(t('properties.rel.clearAssociative'), (d) => void ops.clearAssociative(d, model.id, entity.id, { keepEntity: true }))}>
              {t('properties.rel.clearAssociative')}
            </Button>
          </div>
          <RelationshipEditor model={model} rel={assoc} embedded />
        </Section>
      ) : null}
      <Section title={t('properties.attrs.title')} actions={<AddAttributeMenu model={model} owner={{ kind: 'entity', id: entity.id }} />} testId="attributes-section">
        {ownAttributes(model, 'entity', entity.id).length === 0 ? <Note>{t('properties.attrs.empty')}</Note> : null}
        <AttributeList model={model} owner={{ kind: 'entity', id: entity.id }} />
      </Section>
      {participations.length > 0 ? (
        <Section title={t('properties.entity.relationships')} collapsible defaultOpen={false}>
          <ul className="pp-plain-list">
            {participations.map(({ relationship, participant }) => (
              <li key={participant.id}>
                <button type="button" className="pp-link" onClick={() => selectRef({ kind: 'relationship', id: relationship.id })}>
                  {relationship.name}
                  {participant.role ? ` (${participant.role})` : ''}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

// ----- attribute -----------------------------------------------------------------------------------------------------------

export function AttributePanel({ model, attr }: { model: ErModel; attr: ErAttribute }) {
  const t = useT();
  const issueMap = useIssueMap();
  const top = attr.owner.kind !== 'attribute';
  const ownerName = attr.owner.kind === 'entity' ? model.entities[attr.owner.id]?.name : attr.owner.kind === 'relationship' ? model.relationships[attr.owner.id]?.name : model.attributes[attr.owner.id]?.name;
  const root = rootOwner(model, attr);
  const siblings = Object.values(model.attributes)
    .filter((a) => a.id !== attr.id && root && rootOwner(model, a)?.id === root.id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const patch = (label: string, p: ops.AttributePatch): boolean => runEdit(label, (d) => ops.updateAttribute(d, model.id, attr.id, p));
  const flavor = attr.key === 'primary' ? 'key' : attr.key === 'partial' ? 'partial-key' : attr.multivalued ? 'multivalued' : attr.derived ? 'derived' : attributesOf(model, { kind: 'attribute', id: attr.id }).length ? 'composite' : 'simple';
  return (
    <>
      <GlyphHeader spec={{ kind: 'attribute', flavor }} title={attr.name} kind={t('properties.kind.attribute')} />
      <IssueBadges issues={issuesOf(issueMap, { kind: 'attribute', id: attr.id })} />
      <Section title={t('properties.section.general')} testId="attribute-panel">
        <CommitInput label={t('properties.name')} required value={attr.name} onCommit={(name) => patch(t('properties.rename'), { name })} />
        <Select
          label={t('properties.attr.key')}
          value={attr.key}
          disabled={!top}
          description={top ? undefined : t('properties.attr.keyNested')}
          options={[
            { value: 'none', label: t('properties.key.none') },
            { value: 'primary', label: t('properties.key.primary') },
            { value: 'partial', label: t('properties.key.partial') },
          ]}
          onChange={(v) => patch(t('properties.attrs.setKey'), { key: v as ErAttribute['key'] })}
        />
        <Switch label={t('properties.attr.multivalued')} checked={attr.multivalued} onChange={(multivalued) => patch(t('properties.attrs.toggle'), { multivalued })} />
        <Switch label={t('properties.attr.derived')} checked={attr.derived} description={t('properties.attr.derivedDesc')} onChange={(derived) => patch(t('properties.attrs.toggle'), { derived })} />
        <Switch label={t('properties.attr.optional')} checked={!!attr.optional} disabled={attr.key !== 'none'} description={attr.key !== 'none' ? t('properties.attr.optionalKey') : undefined} onChange={(v) => patch(t('properties.attrs.toggle'), { optional: v ? true : undefined })} />
        <CommitInput label={t('properties.attr.dataType')} mono list="pp-sql-types" value={attr.dataType ?? ''} placeholder={t('properties.attr.dataTypePlaceholder')} onCommit={(v) => patch(t('properties.attrs.setType'), { dataType: v || undefined })} />
        <CommitTextarea label={t('properties.description')} value={attr.description ?? ''} onCommit={(v) => patch(t('properties.describe'), { description: v.trim() === '' ? undefined : v })} />
        <Select
          label={t('properties.attr.owner')}
          value={ownerValue(attr.owner)}
          description={t('properties.attr.ownerDesc')}
          options={ownerChoices(model, attr.id).map((c) => ({ value: c.value, label: c.label }))}
          onChange={(v) => {
            const choice = ownerChoices(model, attr.id).find((c) => c.value === v);
            if (choice) moveAttributeTo(model.id, attr.id, choice.owner, editorStore.getState().activeDiagramId);
          }}
        />
        <div className="pp-owner">
          <button type="button" className="pp-link" onClick={() => selectRef({ kind: attr.owner.kind, id: attr.owner.id })}>
            {t('properties.attr.goToOwner', { name: ownerName ?? '?' })}
          </button>
        </div>
      </Section>
      {attr.derived ? (
        <Section title={t('properties.attr.derivedFrom')} testId="derived-from">
          {siblings.length === 0 ? <Note>{t('properties.attr.derivedFromEmpty')}</Note> : null}
          <div className="pp-checklist" role="group" aria-label={t('properties.attr.derivedFrom')}>
            {siblings.map((s) => (
              <Checkbox
                key={s.id}
                label={s.name}
                checked={!!attr.derivedFrom?.includes(s.id)}
                onChange={(on) => {
                  const cur = attr.derivedFrom ?? [];
                  const next = on ? [...cur, s.id] : cur.filter((x) => x !== s.id);
                  patch(t('properties.attr.setDerivedFrom'), { derivedFrom: next.length ? next : undefined });
                }}
              />
            ))}
          </div>
        </Section>
      ) : null}
      <Section title={t('properties.attrs.subTitle')} actions={<AddAttributeMenu model={model} owner={{ kind: 'attribute', id: attr.id }} />}>
        {attributesOf(model, { kind: 'attribute', id: attr.id }).length === 0 ? <Note>{t('properties.attrs.subEmpty')}</Note> : null}
        <AttributeList model={model} owner={{ kind: 'attribute', id: attr.id }} />
      </Section>
    </>
  );
}

// ----- participants --------------------------------------------------------------------------------------------------------

export function ParticipantCard({ model, rel, p, index, standalone }: { model: ErModel; rel: ErRelationship; p: ErParticipant; index: number; standalone?: boolean }) {
  const t = useT();
  const issueMap = useIssueMap();
  const n = index + 1;
  const entities = Object.values(model.entities).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const patch = (label: string, v: ops.ParticipantPatch): boolean => runEdit(label, (d) => ops.updateParticipant(d, model.id, rel.id, p.id, v));
  const identified = rel.identifying && identifiedParticipants(model, rel).some((x) => x.id === p.id);
  /** Short visible label; the participant number lives in the accessible name (several cards share one panel). */
  const aria = (key: string): string => `${t(key)}${t('properties.rel.participantSuffix', { n })}`;
  return (
    <li className="pp-card" data-participant-id={p.id}>
      <div className="pp-card-head">
        <Select
          label={t('properties.rel.entityOf', { n })}
          hideLabel
          className="pp-grow"
          value={p.entityId}
          options={entities.map((e) => ({ value: e.id, label: e.name }))}
          onChange={(entityId) => patch(t('properties.rel.setEntity'), { entityId })}
        />
        <IssueDot issues={issuesOf(issueMap, { kind: 'participant', relationshipId: rel.id, id: p.id })} />
        {!standalone ? <IconButton size="sm" icon="trash" label={t('properties.rel.removeParticipant', { n, name: participantLabel(model, p) })} onClick={() => runEdit(t('properties.rel.removeParticipantLabel'), (d) => ops.removeParticipant(d, model.id, rel.id, p.id))} /> : null}
      </div>
      <CommitInput label={t('properties.rel.role')} ariaLabel={aria('properties.rel.role')} value={p.role ?? ''} placeholder={t('properties.rel.rolePlaceholder')} onCommit={(v) => patch(t('properties.rel.setRole'), { role: v === '' ? undefined : v })} />
      <div className="pp-pair">
        <Select
          label={t('properties.rel.cardinality')} aria-label={aria('properties.rel.cardinality')}
          value={p.max}
          options={[
            { value: 'one', label: t('properties.rel.one') },
            { value: 'many', label: t('properties.rel.many') },
          ]}
          onChange={(max) => patch(t('properties.rel.setCardinality'), { max: max as 'one' | 'many' })}
        />
        <Select
          label={t('properties.rel.participation')} aria-label={aria('properties.rel.participation')}
          value={p.participation}
          description={identified ? t(p.participation === 'total' ? 'properties.rel.identifiedTotal' : 'properties.rel.identifiedShouldBeTotal') : undefined}
          options={[
            { value: 'partial', label: t('properties.rel.partial') },
            { value: 'total', label: t('properties.rel.total') },
          ]}
          onChange={(participation) => patch(t('properties.rel.setParticipation'), { participation: participation as 'partial' | 'total' })}
        />
      </div>
    </li>
  );
}

// ----- relationship --------------------------------------------------------------------------------------------------------

export function RelationshipEditor({ model, rel, embedded }: { model: ErModel; rel: ErRelationship; embedded?: boolean }) {
  const t = useT();
  const [choosing, setChoosing] = useState(false);
  const assocEntity = Object.values(model.entities).find((e) => e.associativeOf === rel.id);
  const analysis = analyzeRelationship(model, rel.id);
  const effects = effectLines(model, rel);
  const candidate = relationshipCandidateKeys(rel);
  const label = (ids: readonly Id[]): string => ids.map((id) => participantLabel(model, rel.participants.find((p) => p.id === id)!)).join(' + ');
  const identified = currentIdentified(model, rel);
  const choices = identifiedChoices(model, rel);
  const patch = (label: string, p: Parameters<typeof ops.updateRelationship>[3]): boolean => runEdit(label, (d) => ops.updateRelationship(d, model.id, rel.id, p));
  const setIdentifying = (on: boolean, identifiedParticipantId?: Id): boolean =>
    runEdit(t('properties.rel.toggleIdentifying'), (d) => ops.setIdentifying(d, model.id, rel.id, on, identifiedParticipantId ? { identifiedParticipantId } : {}));
  return (
    <>
      {!embedded ? <GlyphHeaderForRel rel={rel} /> : null}
      <Section title={embedded ? t('properties.rel.title') : t('properties.section.general')}>
        <CommitInput label={t('properties.name')} required value={rel.name} onCommit={(name) => patch(t('properties.rename'), { name })} />
        <Switch
          label={t('properties.rel.identifying')}
          checked={rel.identifying || choosing}
          disabled={!!assocEntity}
          description={assocEntity ? t('properties.rel.identifyingAssociative') : t('properties.rel.identifyingDesc')}
          onChange={(on) => {
            if (!on) {
              setChoosing(false);
              setIdentifying(false);
            } else if (choices.length > 0 && rel.participants.length >= 2) setChoosing(true);
            else if (setIdentifying(true)) setChoosing(false);
          }}
        />
        {rel.identifying || choosing ? (
          <Select
            label={t('properties.rel.identified')}
            description={rel.identifying && !identified ? t('properties.rel.identifiedAmbiguous') : t('properties.rel.identifiedDesc')}
            value={identified?.id ?? ''}
            options={[{ value: '', label: t('properties.rel.identifiedChoose'), disabled: true }, ...rel.participants.map((p) => ({ value: p.id, label: participantLabel(model, p) }))]}
            onChange={(id) => {
              if (id && setIdentifying(true, id)) setChoosing(false);
            }}
          />
        ) : null}
        <CommitTextarea label={t('properties.description')} value={rel.description ?? ''} onCommit={(v) => patch(t('properties.describe'), { description: v.trim() === '' ? undefined : v })} />
      </Section>
      <Section
        title={t('properties.rel.participants')}
        testId="participants-section"
        actions={
          <Button
            size="sm"
            icon="plus"
            data-testid="add-participant"
            disabled={Object.keys(model.entities).length === 0}
            onClick={() => {
              const entityId = defaultParticipantEntity(model, rel);
              if (entityId) runEdit(t('properties.rel.addParticipant'), (d) => {
                const res = ops.addParticipant(d, model.id, rel.id, { entityId });
                ops.applyIdentifyingDefaults(d, model.id, rel.id, res.refs[0]!.id);
              });
            }}
          >
            {t('properties.rel.addParticipant')}
          </Button>
        }
      >
        {Object.keys(model.entities).length === 0 ? <Note>{t('properties.rel.noEntities')}</Note> : null}
        {rel.participants.length === 0 && Object.keys(model.entities).length > 0 ? <Note>{t('properties.rel.noParticipants')}</Note> : null}
        {rel.participants.length > 0 ? <Note>{t('properties.rel.participationHint')}</Note> : null}
        <ul className="pp-cards">
          {rel.participants.map((p, i) => (
            <ParticipantCard key={p.id} model={model} rel={rel} p={p} index={i} />
          ))}
        </ul>
      </Section>
      {rel.participants.length >= 2 ? (
        <Section title={t('properties.rel.effect')} testId="effect-section">
          {analysis ? (
            <p className="pp-shape">
              <strong>{t(`properties.rel.shape.${analysis.shape}`)}</strong>
              {analysis.recursive ? `, ${t('properties.rel.recursive')}` : ''}
            </p>
          ) : null}
          <ul className="pp-plain-list" data-testid="effect-lines">
            {effects.map((e, i) => (
              <li key={i}>{t(`properties.rel.effect.${e.key}`, e.params)}</li>
            ))}
          </ul>
          {needsKeyPicker(model, rel) && analysis ? (
            <div className="pp-keys" data-testid="key-picker">
              <p className="pp-note pp-note-muted">
                {t('properties.rel.candidateKeys')} {candidate.map((k) => `{${label(k)}}`).join(', ')}
              </p>
              <div className="pp-checklist" role="group" aria-label={t('properties.rel.keyParticipants')}>
                {rel.participants.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={participantLabel(model, p)}
                    checked={analysis.chosenKey.includes(p.id)}
                    onChange={(on) => patch(t('properties.rel.setKey'), { keyParticipantIds: toggleKeyParticipant(rel, analysis.chosenKey, p.id, on) })}
                  />
                ))}
              </div>
              {!analysis.chosenKeyValid ? <Note tone="warning">{t('properties.rel.keyInvalid')}</Note> : null}
              {analysis.keySource === 'user' ? (
                <div>
                  <Button size="sm" onClick={() => patch(t('properties.rel.setKey'), { keyParticipantIds: undefined })}>
                    {t('properties.rel.useDerivedKey')}
                  </Button>
                </div>
              ) : (
                <Note>{t('properties.rel.keyDerived')}</Note>
              )}
            </div>
          ) : null}
        </Section>
      ) : null}
      {!assocEntity ? (
        <Section title={t('properties.attrs.title')} actions={<AddAttributeMenu model={model} owner={{ kind: 'relationship', id: rel.id }} />} testId="attributes-section">
          {ownAttributes(model, 'relationship', rel.id).length === 0 ? <Note>{t('properties.rel.attrsEmpty')}</Note> : null}
          <AttributeList model={model} owner={{ kind: 'relationship', id: rel.id }} />
        </Section>
      ) : null}
      {!embedded && !assocEntity ? (
        <Section title={t('properties.rel.associativeTitle')} collapsible defaultOpen={false}>
          <Note>{t('properties.rel.associativeDesc')}</Note>
          <div>
            <Button
              size="sm"
              disabled={rel.identifying}
              onClick={() => {
                const diagramId = editorStore.getState().activeDiagramId;
                let nodeId: Id | undefined;
                runEdit(
                  t('properties.rel.makeAssociative'),
                  (d) => {
                    const res = ops.makeAssociative(d, model.id, rel.id);
                    if (diagramId) nodeId = res.nodeIds[diagramId]?.[0] ?? Object.values(d.diagrams[diagramId]!.nodes).find((n) => n.ref.kind === 'entity' && n.ref.id === res.refs[0]!.id)?.id;
                  },
                  { select: () => (nodeId ? [nodeId] : undefined) },
                );
              }}
            >
              {t('properties.rel.makeAssociative')}
            </Button>
          </div>
          {rel.identifying ? <Note tone="warning">{t('properties.rel.identifyingAssociative')}</Note> : null}
        </Section>
      ) : null}
    </>
  );
}

function GlyphHeaderForRel({ rel }: { rel: ErRelationship }) {
  const t = useT();
  const issueMap = useIssueMap();
  return (
    <>
      <GlyphHeader spec={{ kind: 'relationship', identifying: rel.identifying }} title={rel.name} kind={rel.identifying ? t('properties.kind.identifying') : t('properties.kind.relationship')} />
      <IssueBadges issues={issuesOf(issueMap, { kind: 'relationship', id: rel.id })} />
    </>
  );
}

export function RelationshipPanel({ model, rel }: { model: ErModel; rel: ErRelationship }) {
  return <RelationshipEditor model={model} rel={rel} />;
}

/** The participation line itself: one card plus a way back to its relationship. */
export function ParticipantPanel({ model, rel, p }: { model: ErModel; rel: ErRelationship; p: ErParticipant }) {
  const t = useT();
  const index = rel.participants.findIndex((x) => x.id === p.id);
  const entity = model.entities[p.entityId];
  return (
    <>
      <GlyphHeader spec={{ kind: 'relationship', identifying: rel.identifying }} title={`${rel.name} – ${entity?.name ?? '?'}`} kind={t('properties.kind.participant')} />
      <Section title={t('properties.rel.participant', { n: index + 1 })} testId="participant-panel">
        <ul className="pp-cards">
          <ParticipantCard model={model} rel={rel} p={p} index={index} standalone />
        </ul>
        <div>
          <button type="button" className="pp-link" onClick={() => selectRef({ kind: 'relationship', id: rel.id })}>
            {t('properties.rel.open', { name: rel.name })}
          </button>
        </div>
      </Section>
    </>
  );
}

