import { h, Fragment } from 'preact';
import { useState, useRef } from 'preact/hooks';
import Tesseract from 'tesseract.js';

import { HorseState } from './HorseDefTypes';

interface ParsedUmaData {
	name: string;
	stats: {
		speed: number;
		stamina: number;
		power: number;
		guts: number;
		wisdom: number;
	};
	aptitudes: {
		track: { turf: string; dirt: string };
		distance: { sprint: string; mile: string; medium: string; long: string };
		style: { front: string; pace: string; late: string; end: string };
	};
	skills: string[];
}

interface ImageParserProps {
	onDataParsed: (data: ParsedUmaData) => void;
	onError: (error: string) => void;
}

export function ImageParser({ onDataParsed, onError }: ImageParserProps) {
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [lastParsedData, setLastParsedData] = useState<ParsedUmaData | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileSelect = async (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			onError('Please select an image file');
			return;
		}

		setIsProcessing(true);
		setProgress(0);

		try {
			// Process image with Tesseract.js
			const { data: { text } } = await Tesseract.recognize(file, 'eng+jpn', {
				logger: (m) => {
					if (m.status === 'recognizing text') {
						setProgress(Math.round(m.progress * 100));
					}
				}
			});

			// Parse the extracted text
			const parsedData = parseUmaData(text);
			setLastParsedData(parsedData);
			onDataParsed(parsedData);
		} catch (error) {
			onError(`Failed to process image: ${error.message}`);
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const parseUmaData = (text: string): ParsedUmaData => {
		console.log('Raw OCR text:', text);
		const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
		console.log('OCR lines:', lines);
		
		// Extract Uma name (usually appears after "Umamusume Details" or similar)
		const name = extractUmaName(lines);
		console.log('Extracted name:', name);
		
		// Extract stats (Speed, Stamina, Power, Guts, Wit)
		const stats = extractStats(lines);
		console.log('Extracted stats:', stats);
		
		// Extract aptitudes
		const aptitudes = extractAptitudes(lines);
		console.log('Extracted aptitudes:', aptitudes);
		
		// Extract skills
		const skills = extractSkills(lines);
		console.log('Extracted skills:', skills);

		const result = {
			name,
			stats,
			aptitudes,
			skills
		};
		
		console.log('Final parsed data:', result);
		return result;
	};

	const extractUmaName = (lines: string[]): string => {
		// Look for patterns like "Narita Taishin" or similar Uma names
		// This is a simplified approach - you might need to refine based on actual OCR results
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Look for lines that might contain Uma names (typically 2-4 words, mixed case)
			if (line.match(/^[A-Za-z\s]{3,30}$/) && !line.includes('Details') && !line.includes('Speed') && !line.includes('Stamina')) {
				return line;
			}
		}
		return 'Unknown Uma';
	};

	const extractStats = (lines: string[]): ParsedUmaData['stats'] => {
		const stats = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
		
		// Look for stat patterns more systematically
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			
			// Look for patterns like "S 1012" or "SS 1132" or just numbers
			const statMatch = line.match(/([A-Z]+)\s+(\d+)/);
			const numberMatch = line.match(/(\d{3,4})/);
			
			if (statMatch) {
				const [, grade, value] = statMatch;
				const numValue = parseInt(value);
				
				// Try to identify which stat this is based on context and value ranges
				if (line.toLowerCase().includes('speed') || (grade === 'S' && numValue > 1000)) {
					stats.speed = numValue;
				} else if (line.toLowerCase().includes('stamina') || (grade === 'SS' && numValue > 1000)) {
					stats.stamina = numValue;
				} else if (line.toLowerCase().includes('power') || (grade === 'C' && numValue < 700)) {
					stats.power = numValue;
				} else if (line.toLowerCase().includes('guts') || (grade === 'C' && numValue > 500 && numValue < 700)) {
					stats.guts = numValue;
				} else if (line.toLowerCase().includes('wit') || (grade === 'D' && numValue < 500)) {
					stats.wisdom = numValue;
				}
			} else if (numberMatch) {
				// If we just find numbers, try to assign them based on typical ranges
				const numValue = parseInt(numberMatch[1]);
				if (numValue > 1000 && stats.speed === 0) {
					stats.speed = numValue;
				} else if (numValue > 1000 && stats.stamina === 0) {
					stats.stamina = numValue;
				} else if (numValue < 700 && numValue > 500 && stats.power === 0) {
					stats.power = numValue;
				} else if (numValue < 700 && numValue > 500 && stats.guts === 0) {
					stats.guts = numValue;
				} else if (numValue < 500 && stats.wisdom === 0) {
					stats.wisdom = numValue;
				}
			}
		}
		
		return stats;
	};

	const extractAptitudes = (lines: string[]): ParsedUmaData['aptitudes'] => {
		const aptitudes = {
			track: { turf: 'G', dirt: 'G' },
			distance: { sprint: 'G', mile: 'G', medium: 'G', long: 'G' },
			style: { front: 'G', pace: 'G', late: 'G', end: 'G' }
		};

		// Look for aptitude patterns
		for (const line of lines) {
			// Track aptitudes
			if (line.includes('Turf') || line.includes('turf')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.track.turf = match[1];
			}
			if (line.includes('Dirt') || line.includes('dirt')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.track.dirt = match[1];
			}

			// Distance aptitudes
			if (line.includes('Sprint') || line.includes('sprint')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.distance.sprint = match[1];
			}
			if (line.includes('Mile') || line.includes('mile')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.distance.mile = match[1];
			}
			if (line.includes('Medium') || line.includes('medium')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.distance.medium = match[1];
			}
			if (line.includes('Long') || line.includes('long')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.distance.long = match[1];
			}

			// Style aptitudes
			if (line.includes('Front') || line.includes('front')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.style.front = match[1];
			}
			if (line.includes('Pace') || line.includes('pace')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.style.pace = match[1];
			}
			if (line.includes('Late') || line.includes('late')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.style.late = match[1];
			}
			if (line.includes('End') || line.includes('end')) {
				const match = line.match(/([A-Z])\s*$/);
				if (match) aptitudes.style.end = match[1];
			}
		}

		return aptitudes;
	};

	const extractSkills = (lines: string[]): string[] => {
		const skills: string[] = [];
		
		// Look for skill names - this is tricky as skill names can vary
		// We'll look for common patterns and try to match against known skills
		for (const line of lines) {
			// Skip lines that are clearly not skills
			if (line.includes('Speed') || line.includes('Stamina') || line.includes('Power') || 
				line.includes('Guts') || line.includes('Wit') || line.includes('Details') ||
				line.includes('Track') || line.includes('Distance') || line.includes('Style')) {
				continue;
			}

			// Look for potential skill names (typically 2-6 words, mixed case)
			if (line.match(/^[A-Za-z\s]{4,50}$/) && line.length > 3) {
				// This is a very basic approach - you might want to implement
				// fuzzy matching against known skill names from the skill database
				skills.push(line);
			}
		}

		return skills.slice(0, 10); // Limit to first 10 potential skills
	};


	return (
		<div class="imageParser">
			<h3>Parse Uma from Image</h3>
			<div class="uploadArea">
				<input
					type="file"
					ref={fileInputRef}
					accept="image/*"
					onChange={handleFileSelect}
					style="display: none"
				/>
				<button
					onClick={() => fileInputRef.current?.click()}
					disabled={isProcessing}
					class="uploadButton"
				>
					{isProcessing ? `Processing... ${progress}%` : 'Select Image'}
				</button>
			</div>
			{isProcessing && (
				<div class="progressBar">
					<div class="progressFill" style={`width: ${progress}%`}></div>
				</div>
			)}
			{lastParsedData && (
				<div class="parsedData">
					<h4>Parsed Data:</h4>
					<div class="statRow">
						<span><strong>Name:</strong> {lastParsedData.name}</span>
					</div>
					<div class="statRow">
						<span><strong>Speed:</strong> {lastParsedData.stats.speed}</span>
						<span><strong>Stamina:</strong> {lastParsedData.stats.stamina}</span>
					</div>
					<div class="statRow">
						<span><strong>Power:</strong> {lastParsedData.stats.power}</span>
						<span><strong>Guts:</strong> {lastParsedData.stats.guts}</span>
					</div>
					<div class="statRow">
						<span><strong>Wisdom:</strong> {lastParsedData.stats.wisdom}</span>
					</div>
					<div class="statRow">
						<span><strong>Track:</strong> Turf {lastParsedData.aptitudes.track.turf}, Dirt {lastParsedData.aptitudes.track.dirt}</span>
					</div>
					<div class="statRow">
						<span><strong>Distance:</strong> Sprint {lastParsedData.aptitudes.distance.sprint}, Mile {lastParsedData.aptitudes.distance.mile}, Medium {lastParsedData.aptitudes.distance.medium}, Long {lastParsedData.aptitudes.distance.long}</span>
					</div>
					<div class="statRow">
						<span><strong>Style:</strong> Front {lastParsedData.aptitudes.style.front}, Pace {lastParsedData.aptitudes.style.pace}, Late {lastParsedData.aptitudes.style.late}, End {lastParsedData.aptitudes.style.end}</span>
					</div>
					{lastParsedData.skills.length > 0 && (
						<div class="skillList">
							<strong>Skills:</strong>
							{lastParsedData.skills.map((skill, i) => (
								<div key={i} class="skillItem">{skill}</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
