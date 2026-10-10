// A public, data-free app shell. Account data is loaded by CRM through its
// authenticated online loader or the explicitly unlocked IndexedDB snapshot.
import React from 'react';
import {createRoot} from 'react-dom/client';
import CRM from './crm-app';
import EmailSession from './email-session';
import 'leaflet/dist/leaflet.css';
import './globals.css';

const container=document.getElementById('yourrest-offline-app');
if(!container)throw new Error('Yourrest app root is missing');
createRoot(container).render(<><EmailSession/><CRM/></>);
