import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={title:'Gost Home — календарь съёмок',description:'План съёмок, команда и контент Gost Home'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
