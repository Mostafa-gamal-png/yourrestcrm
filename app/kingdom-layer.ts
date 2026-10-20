import type * as Leaflet from 'leaflet';
import {kingdomRings} from '@/lib/kingdom-border';
import './kingdom-map.css';

/** Greys out everything beyond the Kingdom's border and draws the border itself, so a map shows the Kingdom and nothing of its neighbours.
 * The mask sits between the tiles and the markers, takes no clicks, and is drawn as SVG even on a canvas-rendered map so that its colour follows the theme. */
export function addKingdomLayer(L:typeof Leaflet,map:Leaflet.Map){
 if(!map.getPane('kingdomMask')){const pane=map.createPane('kingdomMask');pane.style.zIndex='250';pane.style.pointerEvents='none';}
 const renderer=L.svg({pane:'kingdomMask',padding:0.5});
 const world:[number,number][]=[[-85,-180],[-85,180],[85,180],[85,-180]];
 const rings=kingdomRings.map(ring=>ring.map(([latitude,longitude])=>[latitude,longitude] as [number,number]));
 L.polygon([world,...rings],{renderer,className:'kingdom-mask',interactive:false,stroke:false,fill:true,fillOpacity:1}).addTo(map);
 L.polyline(rings.map(ring=>[...ring,ring[0]]),{renderer,className:'kingdom-border',interactive:false,fill:false,weight:1.6}).addTo(map);
}
