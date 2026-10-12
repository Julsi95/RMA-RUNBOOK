-- Demo data for a fresh project. Existing browser mock data is intentionally not imported.
insert into public.employees(id,name,role,manager_id,sort_order) values
 ('team-lead','Morgan Lee','Team Lead',null,0),
 ('campaign-specialist-1','Jordan Taylor','Campaign Specialist','team-lead',1),
 ('campaign-specialist-2','Quinn Rivera','Campaign Specialist','team-lead',2),
 ('senior-agent-1','Avery Chen','Senior Agent','team-lead',3),
 ('customer-rep-1','Sam Rivera','Customer Rep','senior-agent-1',4),
 ('customer-rep-2','Casey Morgan','Customer Rep','senior-agent-1',5),
 ('customer-rep-3','Jamie Patel','Customer Rep','senior-agent-1',6),
 ('customer-rep-4','Alex Kim','Customer Rep','senior-agent-1',7)
on conflict(id) do nothing;

insert into public.employee_profiles(employee_id) select id from public.employees on conflict(employee_id) do nothing;

insert into public.projects(id,name,description,is_active,sort_order,archived_at) values
 ('project-1','Homeless Callback Queue','',true,0,null),
 ('project-2','I.Tagger','',true,1,null),
 ('project-3','DOA Cases','',true,2,null),
 ('project-4','DOA Hostage','',true,3,null),
 ('project-5','Hostage Unit','',true,4,null),
 ('project-6','Franchisee Sync','',false,5,now()),
 ('project-7','McDonald''s (MCU)','',true,6,null),
 ('project-8','MRA Escalations','',true,7,null),
 ('project-9','OOS Process','',true,8,null),
 ('project-10','OOS Update (Emails and PPR)','',true,9,null),
 ('project-11','Premier Portal','',true,10,null),
 ('project-12','RMA Daily','',true,11,null),
 ('project-13','ERS Queue','',true,12,null),
 ('project-14','Retrieval DOA (Report-Call)','',true,13,null),
 ('project-15','RMA Callback','',true,14,null),
 ('project-16','MRA Repair Status (Inbound Call)','',true,15,null),
 ('project-17','Special Project','',true,16,null),
 ('project-18','Deactivation','',true,17,null)
on conflict(id) do nothing;

insert into public.qa_criteria(id,category,criterion,tcr,tcp,sort_order) values
 ('qa-sample-1','Greeting & discovery','Agent opened the call promptly and used the proper opening script.',14,14,0),
 ('qa-sample-2','Case handling','Agent opened or created the MRA case template and filled it out accurately.',14,14,1),
 ('qa-sample-3','Greeting & discovery','Agent asked relevant and targeted probing questions.',14,14,2),
 ('qa-sample-4','Communication','Agent answered all questions thoroughly and with confidence.',14,14,3),
 ('qa-sample-5','Communication','Agent provided support according to customer needs and educated the customer when needed.',14,13,4),
 ('qa-sample-6','Communication','Agent exhibited understanding of what the customer really wanted.',14,13,5),
 ('qa-sample-7','Case handling','Agent correctly determined which case scenario the customer request falls in.',14,14,6),
 ('qa-sample-8','Case handling','Agent was familiar with the call scenario and knew which procedure to follow to address the customer concern.',14,14,7),
 ('qa-sample-9','Customer experience','Agent provided satisfactory service and met or exceeded the customer expectations.',14,14,8),
 ('qa-sample-10','Customer experience','Agent handled the call in an efficient and timely manner.',14,14,9),
 ('qa-sample-11','Procedure','Agent followed the proper hold procedure.',14,14,10),
 ('qa-sample-12','Communication','Agent spoke clearly, understandably, and at a pace appropriate for the customer.',14,14,11),
 ('qa-sample-13','Documentation','Agent used proper grammar when documenting the case and was mindful of spelling and punctuation.',14,14,12),
 ('qa-sample-14','Professionalism','Agent remained professional.',14,14,13),
 ('qa-sample-15','Professionalism','Agent used the proper closing spiel.',14,14,14),
 ('qa-sample-16','Case handling','Agent provided the correct case number when applicable.',14,14,15),
 ('qa-sample-17','Procedure','Agent disposed of the call in a timely manner.',14,14,16)
on conflict(id) do nothing;

insert into public.app_links(id,name,url,application,group_name,description,sort_order) values
 ('sample-link-team-hub','Team hub','https://example.com/team-hub','Shared workspace','Team resources','Replace this sample with your team hub link.',0),
 ('sample-link-helpdesk','Help desk','https://example.com/help-desk','Support portal','Support tools','Replace this sample with your support portal.',1),
 ('sample-link-training','Training library','https://example.com/training','Learning portal','Learning','Replace this sample with your training link.',2)
on conflict(id) do nothing;

insert into public.kpi_scoring_versions(label,settings) values (
 'Initial sample rules',
 '{
   "metrics":{
     "qa":{"weightPercent":15,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""},
     "callsHandled":{"weightPercent":20,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""},
     "completionCount":{"weightPercent":48,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""},
     "error":{"weightPercent":2,"mode":"manual","direction":"lower","scoreFiveAt":"","scoreZeroAt":""},
     "kudos":{"weightPercent":0,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""},
     "absenteeism":{"weightPercent":5,"mode":"manual","direction":"lower","scoreFiveAt":"","scoreZeroAt":""},
     "punctuality":{"weightPercent":5,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""},
     "excessiveBreak":{"weightPercent":3,"mode":"manual","direction":"lower","scoreFiveAt":"","scoreZeroAt":""},
     "pci":{"weightPercent":1,"mode":"manual","direction":"higher","scoreFiveAt":"","scoreZeroAt":""}
   },
   "evaluationBands":[
     {"label":"Outstanding","min":4.65},{"label":"Above Average","min":4.4},
     {"label":"On Track","min":4.0},{"label":"Needs Focus","min":0}
   ]
 }'::jsonb
)
on conflict do nothing;

insert into public.current_kpi_scoring(singleton,version_id)
select true,id from public.kpi_scoring_versions order by version_number limit 1
on conflict(singleton) do nothing;

insert into public.kpi_months(month_key,scoring_version_id,status)
select to_char(date_trunc('month',current_date),'YYYY-MM'),version_id,'published'
from public.current_kpi_scoring where singleton
on conflict(month_key) do nothing;

insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,source)
select m.month_key,e.id,e.name,e.role,
'{
 "qa":{"rawValue":"98","equivalentScore":4.9,"weightedScore":0.735,"percentValue":98},
 "callsHandled":{"rawValue":"24","equivalentScore":4.5,"weightedScore":0.9,"percentValue":null},
 "completionCount":{"rawValue":"480","equivalentScore":4.6,"weightedScore":2.208,"percentValue":null},
 "error":{"rawValue":"0","equivalentScore":5,"weightedScore":0.1,"percentValue":null},
 "kudos":{"rawValue":"1","equivalentScore":3,"weightedScore":0,"percentValue":null},
 "absenteeism":{"rawValue":"0","equivalentScore":5,"weightedScore":0.25,"percentValue":null},
 "punctuality":{"rawValue":"0","equivalentScore":5,"weightedScore":0.25,"percentValue":null},
 "excessiveBreak":{"rawValue":"0","equivalentScore":5,"weightedScore":0.15,"percentValue":null},
 "pci":{"rawValue":"0","equivalentScore":5,"weightedScore":0.05,"percentValue":null}
}'::jsonb,
4.648,'Outstanding','seed'
from public.kpi_months m cross join public.employees e where e.deleted_at is null
on conflict(month_key,employee_id,result_revision) do nothing;

insert into public.call_schedule_months(month_start)
values(date_trunc('month',current_date)::date)
on conflict(month_start) do nothing;

insert into public.call_assignments(id,month_start,employee_id,call_start,call_end,sort_order)
select 'call-'||e.id,date_trunc('month',current_date)::date,e.id,v.call_start::time,v.call_end::time,v.sort_order
from (values
  (0,'21:00','22:30'),(1,'22:30','00:00'),(2,'00:00','01:30'),
  (3,'01:30','03:00'),(4,'03:00','04:30'),(5,'04:30','06:00')
) as v(sort_order,call_start,call_end)
join public.employees e on e.sort_order=v.sort_order
on conflict(id) do nothing;

insert into public.work_schedule_months(month_start,work_preset)
values(date_trunc('month',current_date)::date,'9-6')
on conflict(month_start) do nothing;

insert into public.work_schedule_month_assignments(month_start,id,employee_id,start_time,end_time,sort_order)
select date_trunc('month',current_date)::date,'work-'||e.id,e.id,time '21:00',time '06:00',e.sort_order
from public.employees e where e.deleted_at is null
on conflict(month_start,id) do nothing;

insert into public.seat_plans(plan_date,note)
values(current_date,'Sample layout · edit seats and assignments for your team.')
on conflict(plan_date) do nothing;

insert into public.seat_positions(plan_date,seat_id,seat_type,sort_order)
select current_date,'A'||n,'team',n-1 from generate_series(1,4) n
union all
select current_date,'B'||n,'team',n+3 from generate_series(1,4) n
union all
select current_date,'LEAD-'||n,'leadership',n-1 from generate_series(1,4) n
on conflict(plan_date,seat_id) do nothing;

insert into public.seat_assignments(plan_date,seat_id,employee_id)
select current_date,'A'||(e.sort_order+1),e.id from public.employees e where e.sort_order between 0 and 3
union all
select current_date,'B'||(e.sort_order-3),e.id from public.employees e where e.sort_order between 4 and 7
on conflict(plan_date,seat_id) do nothing;

insert into public.vl_months(month_start,updated_on)
values(date_trunc('month',current_date)::date,current_date)
on conflict(month_start) do nothing;

insert into public.vl_credit_entries(id,month_start,employee_id,employee_name_snapshot,employee_role_snapshot,credit_value,sort_order)
select 'vl-seed-'||e.id,date_trunc('month',current_date)::date,e.id,e.name,e.role,
  case e.sort_order when 0 then '7' when 1 then '3.5' when 2 then '2.5' when 3 then '6' when 4 then '2.33' when 5 then 'Proby' when 6 then '15' else 'Proby' end,
  e.sort_order
from public.employees e where e.deleted_at is null
on conflict(id) do nothing;

insert into public.dashboard_revisions(content)
values('{
 "pageTitle":"Good morning",
 "pageDescription":"A clear view of what is happening across your team.",
 "containerGap":14,
 "canvasPadding":0,
 "containers":[
  {"id":"welcome-announcement","type":"announcement","title":"A home base for the whole team","description":"Keep important updates, useful links, and team highlights in one place.","body":"Make this dashboard yours. Open Dashboard Settings to shape the page around the way your team works.","date":"","image":"","buttonLabel":"Meet your people","buttonUrl":"/agent-profiles","width":18,"height":300,"showDate":false,"textPosition":"below","textBackground":"none","textLayers":[],"links":[]},
  {"id":"team-feature","type":"feature","title":"Meet your people","description":"Keep birthdays, milestones, and team details close at hand.","body":"","image":"","buttonLabel":"View profiles","buttonUrl":"/agent-profiles","width":12,"height":250,"showDate":false,"textPosition":"below","textBackground":"none","textLayers":[],"links":[]},
  {"id":"quick-access","type":"quickLinks","title":"Quick access","description":"Jump straight into the tools you use every day.","width":12,"height":250,"showDate":false,"textPosition":"below","textBackground":"none","textLayers":[],"links":[{"id":"link-org","label":"Organization chart","url":"/organizational"},{"id":"link-schedule","label":"Work schedule","url":"/work-schedule"},{"id":"link-kpi","label":"Monthly KPI / QA","url":"/kpi-qa"}]}
 ]
}'::jsonb);

insert into public.dashboard_publication(singleton,revision_id)
select true,id from public.dashboard_revisions order by revision_number limit 1
on conflict(singleton) do nothing;
