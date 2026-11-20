import type { Metadata } from 'next';
import './globals.css';
import './platform.css';
import './notion.css';
import './dark.css';
export const metadata: Metadata={title:'Gost Home — контент-студия',description:'Съёмки, контент-план, согласование и запас роликов Gost Home'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
