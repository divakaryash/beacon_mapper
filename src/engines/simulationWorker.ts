import {NavigationSimulation,compareSimulationDeployments} from './navigationSimulation.ts';
let simulation:NavigationSimulation|null=null;
self.onmessage=({data})=>{
  try {
    let comparison;
    if(data.action==='prepare')simulation=new NavigationSimulation(data.inputs,data.start,data.destination);
    else if(data.action==='compare')comparison=compareSimulationDeployments(data.inputs,data.start,data.destination,data.a,data.b);
    else if(!simulation)throw new Error('Prepare a route first.');
    const state=data.action==='advance'?simulation!.advance(data.value):['prepare','compare'].includes(data.action)?simulation?.stateAt(simulation.elapsed):simulation!.control(data.action,data.value);
    self.postMessage({id:data.id,state,report:data.action==='prepare'?simulation!.report():undefined,comparison});
  }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
