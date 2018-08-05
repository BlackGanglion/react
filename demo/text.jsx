class Button extends React.Component {
  render() {
    return (
      <button style={{background: this.context.color}}>
        {this.props.children}
      </button>
    );
  }
}

Button.contextTypes = {
  color: PropTypes.string
};

class Message extends React.Component {
  render() {
    return (
      <div>
        {this.props.text} <Button>Delete</Button>
      </div>
    );
  }
}

class MessageList extends React.Component {
  getChildContext() {
    return {color: "purple"};
  }

  render() {
    return <Message text="1" />;
  }
}

MessageList.childContextTypes = {
  color: PropTypes.string
};

class Test extends React.Component {
  getChildContext() {
    return {color: "red"};
  }

  render() {
    return <Message text="1" />;
  }
}

Test.childContextTypes = {
  color: PropTypes.string
};

class App extends React.Component {
  render() {
    return (
      <div>
        <MessageList />
        <Test />
      </div>
    );
  }
}                                             
                                             
ReactDOM.render(<App />, document.querySelector('#main'));