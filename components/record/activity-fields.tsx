"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACTIVITY_LABELS, type Activity } from "@/lib/record-history/model"

export type Person = { id: string; name: string }
const TYPES = Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))

export function readActivityFields(data: FormData) {
  return { type: data.get("type"), dueDate: data.get("dueDate"), owner: data.get("owner"), summary: data.get("summary") }
}

/** Type, due date, assignee and summary controls; render inside a form whose grid the parent owns. */
export function ActivityFields({ idPrefix, people, defaults }: {
  idPrefix: string
  people: Person[]
  defaults: { type?: Activity["type"]; dueDate?: string; owner?: string; summary?: string }
}) {
  return <>
    <div className="space-y-2"><Label htmlFor={`${idPrefix}-type`}>Type</Label>
      <Select name="type" defaultValue={defaults.type ?? "follow_up"} items={TYPES}>
        <SelectTrigger id={`${idPrefix}-type`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{TYPES.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="space-y-2"><Label htmlFor={`${idPrefix}-due`}>Due date</Label><Input id={`${idPrefix}-due`} name="dueDate" type="date" required defaultValue={defaults.dueDate} /></div>
    <div className="space-y-2"><Label htmlFor={`${idPrefix}-owner`}>Assignee</Label>
      <Select name="owner" defaultValue={defaults.owner} items={people.map(person => ({ value: person.id, label: person.name }))}>
        <SelectTrigger id={`${idPrefix}-owner`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{people.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="space-y-2 sm:col-span-full"><Label htmlFor={`${idPrefix}-summary`}>Summary</Label><Input id={`${idPrefix}-summary`} name="summary" required maxLength={2000} defaultValue={defaults.summary} /></div>
  </>
}
