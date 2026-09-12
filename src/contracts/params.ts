/**
 * Params — the full parameter set the engine accepts.
 * OWNER: Kaavya. CONSUMED BY: Elsa (sliders), Albert (source table), Oriol (extractor).
 * PRD §4.3. FREEZE BEFORE ANYONE BUILDS.
 *
 * TODO(kaavya): publish this before writing engine code — it unblocks two people.
 *
 * Shape to define:
 *   - SourceTag: 'measured' | 'documented' | 'literature' | 'assumed'
 *   - Sourced<T>: a value + range + source tag + citation. Every parameter carries one.
 *     A parameter with no source is FLAGGED, never silently defaulted.
 *   - Policy-invariant primitives: arrival rates per class, service/delay times, capacities,
 *     routing probabilities.
 *   - Policy levers (5-6): community capacity multiplier, hospital→community routing share,
 *     follow-up channel mix, monitoring intensity, extra GP sessions, discharge timing.
 *   - Declared boundaries, each defaulted to 0: induced demand, substitution, gaming.
 *   - Environment axis (separate from the three worlds): winter pressure, staff shortage.
 *   - Physical bounds per parameter, so extraction can clamp to them.
 *
 * NOT parameters — these are always derived, never set: waits, queue lengths, utilisation.
 */

export {};
