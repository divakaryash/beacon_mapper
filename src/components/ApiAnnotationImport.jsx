import React, {useEffect, useRef, useState} from 'react';
import {IWAY_ENVIRONMENTS, iwayRequest} from '../models/iwayApi.js';

const API_KEYS = {
  dev: import.meta.env.VITE_IWAY_DEV_API_KEY || '',
  maps: import.meta.env.VITE_IWAY_MAPS_API_KEY || '',
};

export default function ApiAnnotationImport({disabled, onLoad, floors, floor, onFloorChange}) {
  const [environment, setEnvironment] = useState('dev');
  const apiKey = API_KEYS[environment].trim();
  const [buildings, setBuildings] = useState([]);
  const [venue, setVenue] = useState('');
  const [building, setBuilding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort(); request.current = null;
    setBuildings([]); setVenue(''); setBuilding(''); setError(''); setBusy(false);
  }
  async function load(id) {
    if (!apiKey) {
      setError(`API key missing for ${IWAY_ENVIRONMENTS[environment].label}. Configure ${environment === 'maps' ? 'Maps_Api_Key' : 'Dev_Api_Key'} in .env and restart the app.`);
      return;
    }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const payload = await iwayRequest(environment, apiKey, id, controller.signal);
      if (controller.signal.aborted) return;
      if (id === undefined) {
        setBuildings(payload); setVenue(''); setBuilding('');
        if (!payload.length) setError('No buildings found in this environment.');
      } else await onLoad(payload);
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally { if (request.current === controller) setBusy(false); }
  }
  return <section>
    <h3>1. Load from iway API</h3>
    <label>Environment<select disabled={disabled} value={environment} onChange={e => {reset(); setEnvironment(e.target.value);}}>{Object.entries(IWAY_ENVIRONMENTS).map(([id, config]) => <option key={id} value={id}>{config.label}</option>)}</select></label>
    {!apiKey && <p role="alert">API key missing for {IWAY_ENVIRONMENTS[environment].label}. Set {environment === 'maps' ? 'Maps_Api_Key' : 'Dev_Api_Key'} in .env and restart the app.</p>}
    <button type="button" disabled={disabled || busy || !apiKey} onClick={() => load()}>{busy ? 'Loading…' : 'Load / refresh venues'}</button>
    <label>Venue<select disabled={disabled || busy || !buildings.length} value={venue} onChange={e => {setVenue(e.target.value); setBuilding(''); setError('');}}><option value="">Select venue</option>{[...new Set(buildings.map(b => b.venueName))].sort().map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <label>Building<select disabled={disabled || busy || !venue} value={building} onChange={e => {setBuilding(e.target.value); setError('');}}><option value="">Select building</option>{buildings.filter(b => b.venueName === venue).map(b => <option key={b._id} value={b._id}>{b.buildingName}</option>)}</select></label>
    <label>Floor / level<select disabled={disabled || busy || !floors.length} value={floor} onChange={e=>onFloorChange(e.target.value)}>{!floors.length&&<option value="">Load annotations to select floor</option>}{floors.map(value=><option key={value} value={value}>Floor {value}</option>)}</select></label>
    <button type="button" disabled={disabled || busy || !apiKey || !building} onClick={() => load(building)}>Load annotations</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
