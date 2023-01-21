importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.2/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.2/dist/wheels/panel-0.14.2-py3-none-any.whl', 'pyodide-http==0.1.0', 'pandas', 'param', 'requests']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import pandas as pd

import bokeh
import panel as pn
import requests
import io
bokeh.plotting.curdoc().theme='dark_minimal'
import param


url = "https://github.com/bowen83/.github.io/raw/edd7e889e75c1c5d612e98f8795eb3c95b6af6de/resampled_blocked.csv" # Make sure the url is the raw version of the file on GitHub
download = requests.get(url).content

# Reading the downloaded content and turning it into a pandas dataframe

df = pd.read_csv(io.StringIO(download.decode('utf-8')))

#df=pd.read_csv(, parse_dates=True)

#df=df.sort_values(by=['Sensor_ID','TimeStamp'])
df.TimeStamp=pd.to_datetime(df.TimeStamp)
Sensor=df.Sensor_ID.unique().tolist()
#Blocked_Sensor=df.loc[df.Blocked==1].Sensor_ID.unique().tolist()


TOOLS = "pan,wheel_zoom,box_zoom,reset,save, hover"


class BlockedDashboard(param.Parameterized):
    
    # drop down selector widget containing the list of plots
    plot = param.ObjectSelector(default=Sensor[0], objects=Sensor)
    
    # create data set containing only the data applicable to the plot in the drop down selector
    def get_data(self):
        class_df = df.loc[df.Sensor_ID==self.plot][['TimeStamp','Sensor_value']].copy()
        return class_df
    

    def line_view(self):
        data=self.get_data()
        data.set_index=data.TimeStamp
        #p=data['Sensor_value'].plot_bokeh(title="Historic level data plot for {} Sensor".format(i), show_figure=False)
        p = bokeh.plotting.figure(x_axis_type="datetime",tools=TOOLS,
            title="Historic level data plot for {} Sensor".format(self.plot),
            x_axis_label='DateTime',
            y_axis_label='Sensor Level',
            active_scroll='wheel_zoom')

        hover=p.select(dict(type=bokeh.models.HoverTool))
        hover.tooltips=[('Period','$x{%Y-%m-%d,%H:%M}'),('Sensor Level','$y')]
        hover.formatters={'$x':'datetime'}

        p.line(data.TimeStamp,data.Sensor_value, line_width=2)
        
        return pn.WidgetBox(p)

bd = BlockedDashboard(name='')

dashboard=pn.Row(bd.param,bd.line_view, sizing_mode='stretch_both')

temp=pn.template.BootstrapTemplate(theme=pn.template.DarkTheme,
         site='Aqua DNA',header_background ='#4099da',header_color='black',
         logo='https://media.licdn.com/dms/image/C4E22AQF-mbaih5LBBQ/feedshare-shrink_2048_1536/0/1642175339327?e=2147483647&v=beta&t=K_CaphKHMMoD2B8H96aneSM6D6kgzyStn7Unaanxojk' 
         ,title="HWM - Historic level data plot for Blocked Sensors")
temp.main.append(dashboard)
temp.servable()





await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()